import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { config } from '../utils/config/config';
import { createLogger } from '../utils/monitoring/logger';

dotenv.config();

const logger = createLogger('check-high-value-tokens-metadata');

interface TokenMetadataStatus {
  mint_address: string;
  symbol: string;
  name: string;
  current_market_cap_usd: number;
  fdv: number;
  metadata_uri: string | null;
  metadata_score: number | null;
  metadata_last_updated: Date | null;
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  website: string | null;
  has_metadata: boolean;
  has_social_links: boolean;
  created_at: Date;
  updated_at: Date;
}

async function checkHighValueTokensMetadata() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    logger.info(`Checking tokens with market cap above $${config.BC_SAVE_THRESHOLD}...`);

    // Query tokens with market cap above threshold
    const query = `
      SELECT 
        mint_address,
        symbol,
        name,
        current_market_cap_usd,
        fdv,
        metadata_uri,
        metadata_score,
        metadata_last_updated,
        twitter,
        telegram,
        discord,
        website,
        created_at,
        updated_at,
        CASE 
          WHEN metadata_uri IS NOT NULL 
            OR metadata_score IS NOT NULL 
            OR metadata_last_updated IS NOT NULL 
          THEN true 
          ELSE false 
        END as has_metadata,
        CASE 
          WHEN twitter IS NOT NULL 
            OR telegram IS NOT NULL 
            OR discord IS NOT NULL 
            OR website IS NOT NULL 
          THEN true 
          ELSE false 
        END as has_social_links
      FROM tokens_unified
      WHERE current_market_cap_usd >= $1
      ORDER BY current_market_cap_usd DESC
    `;

    const result = await pool.query<TokenMetadataStatus>(query, [config.BC_SAVE_THRESHOLD]);
    const tokens = result.rows;

    if (tokens.length === 0) {
      logger.info(`No tokens found with market cap above $${config.BC_SAVE_THRESHOLD}`);
      return;
    }

    logger.info(`Found ${tokens.length} tokens with market cap above $${config.BC_SAVE_THRESHOLD}`);
    console.log('\n' + '='.repeat(150));
    console.log('HIGH VALUE TOKENS METADATA STATUS');
    console.log('='.repeat(150));

    // Summary statistics
    const enrichedCount = tokens.filter(t => t.has_metadata).length;
    const socialLinksCount = tokens.filter(t => t.has_social_links).length;
    const fullyEnrichedCount = tokens.filter(t => t.has_metadata && t.has_social_links).length;
    const notEnrichedCount = tokens.filter(t => !t.has_metadata && !t.has_social_links).length;

    console.log('\nSUMMARY:');
    console.log(`Total tokens above $${config.BC_SAVE_THRESHOLD}: ${tokens.length}`);
    console.log(`Tokens with metadata: ${enrichedCount} (${((enrichedCount / tokens.length) * 100).toFixed(1)}%)`);
    console.log(`Tokens with social links: ${socialLinksCount} (${((socialLinksCount / tokens.length) * 100).toFixed(1)}%)`);
    console.log(`Fully enriched tokens: ${fullyEnrichedCount} (${((fullyEnrichedCount / tokens.length) * 100).toFixed(1)}%)`);
    console.log(`Not enriched at all: ${notEnrichedCount} (${((notEnrichedCount / tokens.length) * 100).toFixed(1)}%)`);

    // Detailed token list
    console.log('\n' + '='.repeat(150));
    console.log('DETAILED TOKEN LIST:');
    console.log('='.repeat(150));
    console.log(
      'Symbol'.padEnd(10) +
      'Name'.padEnd(25) +
      'Market Cap'.padEnd(15) +
      'FDV'.padEnd(15) +
      'Metadata'.padEnd(10) +
      'Social'.padEnd(10) +
      'Score'.padEnd(8) +
      'Last Updated'.padEnd(20) +
      'Mint Address'
    );
    console.log('-'.repeat(150));

    for (const token of tokens) {
      const marketCap = formatCurrency(token.current_market_cap_usd);
      const fdv = formatCurrency(token.fdv);
      const hasMetadata = token.has_metadata ? '✓' : '✗';
      const hasSocial = token.has_social_links ? '✓' : '✗';
      const score = token.metadata_score?.toString() || '-';
      const lastUpdated = token.metadata_last_updated 
        ? new Date(token.metadata_last_updated).toLocaleString() 
        : 'Never';

      console.log(
        (token.symbol || 'Unknown').padEnd(10) +
        (token.name || 'Unknown').padEnd(25) +
        marketCap.padEnd(15) +
        fdv.padEnd(15) +
        hasMetadata.padEnd(10) +
        hasSocial.padEnd(10) +
        score.padEnd(8) +
        lastUpdated.padEnd(20) +
        token.mint_address
      );
    }

    // Show tokens that need enrichment
    const needsEnrichment = tokens.filter(t => !t.has_metadata || !t.has_social_links);
    if (needsEnrichment.length > 0) {
      console.log('\n' + '='.repeat(150));
      console.log('TOKENS NEEDING ENRICHMENT:');
      console.log('='.repeat(150));
      console.log('Symbol'.padEnd(10) + 'Market Cap'.padEnd(15) + 'Missing'.padEnd(30) + 'Mint Address');
      console.log('-'.repeat(150));

      for (const token of needsEnrichment) {
        const missing = [];
        if (!token.has_metadata) missing.push('Metadata');
        if (!token.has_social_links) missing.push('Social Links');
        
        console.log(
          (token.symbol || 'Unknown').padEnd(10) +
          formatCurrency(token.current_market_cap_usd).padEnd(15) +
          missing.join(', ').padEnd(30) +
          token.mint_address
        );
      }
    }

    // Show social links for enriched tokens
    const withSocialLinks = tokens.filter(t => t.has_social_links);
    if (withSocialLinks.length > 0) {
      console.log('\n' + '='.repeat(150));
      console.log('TOKENS WITH SOCIAL LINKS:');
      console.log('='.repeat(150));
      console.log('Symbol'.padEnd(10) + 'Twitter'.padEnd(20) + 'Telegram'.padEnd(20) + 'Discord'.padEnd(20) + 'Website');
      console.log('-'.repeat(150));

      for (const token of withSocialLinks) {
        console.log(
          (token.symbol || 'Unknown').padEnd(10) +
          (token.twitter || '-').padEnd(20) +
          (token.telegram || '-').padEnd(20) +
          (token.discord || '-').padEnd(20) +
          (token.website || '-')
        );
      }
    }

  } catch (error) {
    logger.error('Error checking high value tokens:', error);
  } finally {
    await pool.end();
  }
}

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return '$0';
  
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  } else if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  } else {
    return `$${value.toFixed(2)}`;
  }
}

// Run the script
checkHighValueTokensMetadata().catch(console.error);