import { config } from 'dotenv';
import { Pool } from 'pg';
import { logger } from '../core/logger';
import chalk from 'chalk';

config();

async function checkEnrichmentStatus() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const threshold = parseInt(process.env.BC_SAVE_THRESHOLD || '8888');

  try {
    // Get all tokens above threshold
    const result = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        metadata_enriched,
        metadata_last_updated,
        twitter,
        telegram,
        discord,
        website,
        metadata_score,
        created_at
      FROM tokens_unified
      WHERE latest_market_cap_usd >= $1
      ORDER BY latest_market_cap_usd DESC
    `, [threshold]);

    logger.info(chalk.cyan(`\n=== Tokens Above $${threshold.toLocaleString()} Market Cap ===\n`));
    logger.info(`Found ${result.rows.length} tokens above threshold`);

    if (result.rows.length === 0) {
      logger.info(chalk.yellow('No tokens found above the threshold'));
      return;
    }

    let enrichedCount = 0;
    let needsEnrichment = [];

    logger.info(chalk.gray('\nToken Details:'));
    logger.info(chalk.gray('─'.repeat(100)));

    for (const token of result.rows) {
      const isEnriched = token.metadata_enriched === true;
      const hasMetadata = token.symbol !== 'UNKNOWN' && token.name !== 'Unknown Token';
      const hasSocials = token.twitter || token.telegram || token.discord || token.website;
      
      if (isEnriched || hasMetadata) {
        enrichedCount++;
      } else {
        needsEnrichment.push(token);
      }

      const status = isEnriched ? chalk.green('✓') : chalk.red('✗');
      const mcap = `$${Math.floor(token.latest_market_cap_usd).toLocaleString()}`;
      
      logger.info(
        `${status} ${(token.symbol || 'UNKNOWN').padEnd(10)} | ` +
        `${mcap.padStart(12)} | ` +
        `${token.mint_address.substring(0, 8)}... | ` +
        `Meta: ${token.metadata_enriched ? 'Yes' : 'No'} | ` +
        `Score: ${token.metadata_score || 0} | ` +
        `Socials: ${hasSocials ? 'Yes' : 'No'}`
      );
    }

    logger.info(chalk.gray('─'.repeat(100)));
    
    // Summary
    logger.info(chalk.cyan('\nSummary:'));
    logger.info(`Total high-value tokens: ${result.rows.length}`);
    logger.info(`Enriched with metadata: ${enrichedCount} (${Math.round(enrichedCount/result.rows.length*100)}%)`);
    logger.info(`Need enrichment: ${needsEnrichment.length} (${Math.round(needsEnrichment.length/result.rows.length*100)}%)`);

    if (needsEnrichment.length > 0) {
      logger.info(chalk.yellow('\nTokens needing enrichment:'));
      for (const token of needsEnrichment) {
        logger.info(`  - ${token.mint_address} ($${Math.floor(token.latest_market_cap_usd).toLocaleString()})`);
      }
    }

    // Check if enricher is running
    logger.info(chalk.cyan('\nChecking enrichment activity:'));
    const recentResult = await pool.query(`
      SELECT COUNT(*) as count, MAX(metadata_last_updated) as last_update
      FROM tokens_unified
      WHERE metadata_last_updated > NOW() - INTERVAL '1 hour'
    `);

    const recent = recentResult.rows[0];
    if (recent.count > 0) {
      logger.info(chalk.green(`✓ Enrichment is active: ${recent.count} tokens enriched in last hour`));
      logger.info(`Last enrichment: ${recent.last_update}`);
    } else {
      logger.warn(chalk.yellow('⚠️ No enrichment activity in the last hour'));
    }

  } catch (error) {
    logger.error('Error checking enrichment status:', error);
  } finally {
    await pool.end();
  }
}

checkEnrichmentStatus().catch(console.error);