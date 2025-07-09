import { config } from 'dotenv';
import { Pool } from 'pg';
import { logger } from '../core/logger';
import { ShyftProvider } from '../services/metadata/providers/shyft-provider';
import chalk from 'chalk';

config();

async function enrichAllTokens() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const shyftProvider = ShyftProvider.getInstance();

  try {
    // Get all tokens that need enrichment
    const result = await pool.query(`
      SELECT mint_address, symbol, name, latest_market_cap_usd
      FROM tokens_unified
      WHERE (symbol = 'UNKNOWN' OR symbol IS NULL OR name = 'Unknown Token' OR name IS NULL)
        OR metadata_enriched = false
        OR metadata_enriched IS NULL
      ORDER BY latest_market_cap_usd DESC
    `);

    logger.info(`Found ${result.rows.length} tokens that need enrichment`);

    if (result.rows.length === 0) {
      logger.info('All tokens are already enriched!');
      return;
    }

    // Process in batches
    const BATCH_SIZE = 5;
    let enrichedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
      const batch = result.rows.slice(i, i + BATCH_SIZE);
      
      logger.info(`\nProcessing batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(result.rows.length/BATCH_SIZE)}`);

      // Process batch in parallel
      const promises = batch.map(async (token) => {
        try {
          logger.info(`Enriching ${token.mint_address} (current: ${token.symbol || 'UNKNOWN'})`);
          
          const metadata = await shyftProvider.getTokenInfoDAS(token.mint_address);
          
          if (metadata && (metadata.symbol || metadata.name)) {
            await shyftProvider.storeEnrichedMetadata(metadata);
            enrichedCount++;
            logger.info(chalk.green(`✅ Enriched: ${metadata.symbol || 'UNKNOWN'} - ${metadata.name || 'Unknown'}`));
          } else {
            logger.warn(chalk.yellow(`⚠️ No metadata found for ${token.mint_address}`));
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
        logger.info('Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    logger.info(chalk.green(`\n✅ Enrichment complete!`));
    logger.info(`Successfully enriched: ${enrichedCount} tokens`);
    logger.info(`Failed to enrich: ${failedCount} tokens`);

    // Show current stats
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN metadata_enriched = true THEN 1 END) as enriched_tokens,
        COUNT(CASE WHEN symbol != 'UNKNOWN' AND symbol IS NOT NULL THEN 1 END) as tokens_with_symbol,
        COUNT(CASE WHEN name != 'Unknown Token' AND name IS NOT NULL THEN 1 END) as tokens_with_name
      FROM tokens_unified
    `);

    const stats = statsResult.rows[0];
    logger.info('\nFinal database status:');
    logger.info(`Total tokens: ${stats.total_tokens}`);
    logger.info(`Enriched tokens: ${stats.enriched_tokens}`);
    logger.info(`Tokens with symbol: ${stats.tokens_with_symbol}`);
    logger.info(`Tokens with name: ${stats.tokens_with_name}`);

    // Show Shyft provider stats
    const providerStats = shyftProvider.getStats();
    logger.info('\nShyft provider stats:', providerStats);

  } catch (error) {
    logger.error('Error enriching tokens:', error);
  } finally {
    await pool.end();
  }
}

enrichAllTokens().catch(console.error);