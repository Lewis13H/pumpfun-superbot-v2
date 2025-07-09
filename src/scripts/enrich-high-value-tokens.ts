import { config } from 'dotenv';
import { Pool } from 'pg';
import { logger } from '../core/logger';
import { ShyftProvider } from '../services/metadata/providers/shyft-provider';
import chalk from 'chalk';

config();

async function enrichHighValueTokens() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const shyftProvider = ShyftProvider.getInstance();
  const threshold = parseInt(process.env.BC_SAVE_THRESHOLD || '8888');

  try {
    // Get all tokens above threshold that need enrichment
    const result = await pool.query(`
      SELECT mint_address, symbol, name, latest_market_cap_usd
      FROM tokens_unified
      WHERE latest_market_cap_usd >= $1
        AND (metadata_enriched = false OR metadata_enriched IS NULL)
      ORDER BY latest_market_cap_usd DESC
    `, [threshold]);

    logger.info(chalk.cyan(`\n=== Enriching Tokens Above $${threshold.toLocaleString()} ===\n`));
    logger.info(`Found ${result.rows.length} tokens that need enrichment`);

    if (result.rows.length === 0) {
      logger.info(chalk.green('All high-value tokens are already enriched!'));
      return;
    }

    // Process in batches
    const BATCH_SIZE = 5;
    let enrichedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
      const batch = result.rows.slice(i, i + BATCH_SIZE);
      
      logger.info(chalk.blue(`\nProcessing batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(result.rows.length/BATCH_SIZE)}`));

      // Process batch in parallel
      const promises = batch.map(async (token) => {
        try {
          const mcap = `$${Math.floor(token.latest_market_cap_usd).toLocaleString()}`;
          logger.info(`Enriching ${token.mint_address.substring(0, 8)}... (${mcap})`);
          
          const metadata = await shyftProvider.getTokenInfoDAS(token.mint_address);
          
          if (metadata && (metadata.symbol || metadata.name)) {
            await shyftProvider.storeEnrichedMetadata(metadata);
            enrichedCount++;
            logger.info(chalk.green(`✅ Enriched: ${metadata.symbol || 'UNKNOWN'} - ${metadata.name || 'Unknown'}`));
          } else {
            logger.warn(chalk.yellow(`⚠️ No metadata found for ${token.mint_address.substring(0, 8)}...`));
            failedCount++;
          }
        } catch (error) {
          logger.error(`Failed to enrich ${token.mint_address}:`, error);
          failedCount++;
        }
      });

      await Promise.all(promises);

      // Add delay between batches to respect rate limits
      if (i + BATCH_SIZE < result.rows.length) {
        logger.info(chalk.gray('Waiting 2 seconds before next batch...'));
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    logger.info(chalk.green(`\n✅ Enrichment complete!`));
    logger.info(`Successfully enriched: ${enrichedCount} tokens`);
    logger.info(`Failed to enrich: ${failedCount} tokens`);

    // Show updated stats
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN latest_market_cap_usd >= $1 THEN 1 END) as high_value_tokens,
        COUNT(CASE WHEN latest_market_cap_usd >= $1 AND metadata_enriched = true THEN 1 END) as enriched_high_value,
        COUNT(CASE WHEN symbol != 'UNKNOWN' AND symbol IS NOT NULL THEN 1 END) as tokens_with_symbol,
        COUNT(CASE WHEN name != 'Unknown Token' AND name IS NOT NULL THEN 1 END) as tokens_with_name
      FROM tokens_unified
    `, [threshold]);

    const stats = statsResult.rows[0];
    logger.info(chalk.cyan('\nFinal statistics:'));
    logger.info(`High-value tokens (≥$${threshold.toLocaleString()}): ${stats.high_value_tokens}`);
    logger.info(`Enriched high-value tokens: ${stats.enriched_high_value} (${Math.round(stats.enriched_high_value/stats.high_value_tokens*100)}%)`);
    logger.info(`Total tokens with symbol: ${stats.tokens_with_symbol}`);
    logger.info(`Total tokens with name: ${stats.tokens_with_name}`);

    // Show Shyft provider stats
    const providerStats = shyftProvider.getStats();
    logger.info(chalk.cyan('\nShyft provider stats:'), providerStats);

  } catch (error) {
    logger.error('Error enriching tokens:', error);
  } finally {
    await pool.end();
  }
}

enrichHighValueTokens().catch(console.error);