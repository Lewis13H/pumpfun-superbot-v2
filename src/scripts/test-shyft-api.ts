import { config } from 'dotenv';
import axios from 'axios';
import { logger } from '../core/logger';

config();

async function testShyftAPI() {
  const apiKey = process.env.SHYFT_API_KEY || process.env.SHYFT_GRPC_TOKEN || '';
  
  if (!apiKey) {
    logger.error('No Shyft API key found in environment variables');
    return;
  }

  logger.info('Testing Shyft API with key:', apiKey.substring(0, 10) + '...');

  // Test token to check - one from your database
  const testToken = '82cVoYetp2HsekHUrrmATyWPWR296JBN9akaY4F6hgBF';

  try {
    // Test 1: Token metadata endpoint
    logger.info('Testing token metadata endpoint...');
    const metadataResponse = await axios.get('https://api.shyft.to/sol/v1/token/get_info', {
      params: {
        network: 'mainnet-beta',
        token_address: testToken
      },
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (metadataResponse.data.success) {
      logger.info('✅ Token metadata API working:', {
        symbol: metadataResponse.data.result?.symbol,
        name: metadataResponse.data.result?.name,
        hasData: !!metadataResponse.data.result
      });
    } else {
      logger.error('❌ Token metadata API failed:', metadataResponse.data);
    }

    // Test 2: Check API key validity
    logger.info('\nTesting API key validity...');
    const keyCheckResponse = await axios.get('https://api.shyft.to/sol/v1/wallet/balance', {
      params: {
        network: 'mainnet-beta',
        wallet: '11111111111111111111111111111111' // System program
      },
      headers: {
        'x-api-key': apiKey
      },
      timeout: 5000
    });

    if (keyCheckResponse.data.success) {
      logger.info('✅ API key is valid and working');
    } else {
      logger.error('❌ API key validation failed:', keyCheckResponse.data);
    }

    // Test 3: Check rate limits
    logger.info('\nChecking rate limit headers...');
    const headers = metadataResponse.headers;
    logger.info('Rate limit info:', {
      limit: headers['x-ratelimit-limit'],
      remaining: headers['x-ratelimit-remaining'],
      reset: headers['x-ratelimit-reset']
    });

  } catch (error: any) {
    if (error.response) {
      logger.error('API Error:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      });

      if (error.response.status === 401) {
        logger.error('🔑 API key is invalid or expired');
      } else if (error.response.status === 429) {
        logger.error('⏳ Rate limit exceeded');
      } else if (error.response.status === 404) {
        logger.error('📍 Endpoint not found - API may have changed');
      }
    } else if (error.request) {
      logger.error('No response received:', error.message);
    } else {
      logger.error('Request setup error:', error.message);
    }
  }

  // Check if enricher is using the API
  logger.info('\nChecking enrichment status in database...');
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN metadata_enriched = true THEN 1 END) as enriched_tokens,
        COUNT(CASE WHEN symbol != 'UNKNOWN' AND symbol IS NOT NULL THEN 1 END) as tokens_with_symbol,
        COUNT(CASE WHEN name != 'Unknown Token' AND name IS NOT NULL THEN 1 END) as tokens_with_name,
        MAX(metadata_last_updated) as last_enrichment
      FROM tokens_unified
    `);

    const stats = result.rows[0];
    logger.info('Database enrichment status:', {
      totalTokens: stats.total_tokens,
      enrichedTokens: stats.enriched_tokens,
      tokensWithSymbol: stats.tokens_with_symbol,
      tokensWithName: stats.tokens_with_name,
      lastEnrichment: stats.last_enrichment || 'Never'
    });

    // Check recent enrichment activity
    const recentResult = await pool.query(`
      SELECT mint_address, symbol, name, metadata_last_updated
      FROM tokens_unified
      WHERE metadata_last_updated IS NOT NULL
      ORDER BY metadata_last_updated DESC
      LIMIT 5
    `);

    if (recentResult.rows.length > 0) {
      logger.info('\nRecently enriched tokens:');
      recentResult.rows.forEach(token => {
        logger.info(`  ${token.symbol || 'UNKNOWN'} - ${token.name || 'Unknown'} - ${token.metadata_last_updated}`);
      });
    } else {
      logger.warn('No tokens have been enriched recently');
    }

  } finally {
    await pool.end();
  }
}

testShyftAPI().catch(console.error);