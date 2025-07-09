/**
 * Fetch token metadata using Shyft API
 */

import 'dotenv/config';
import { db } from '../database';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import axios from 'axios';

const logger = new Logger({ context: 'FetchMetadataShyft', color: chalk.cyan });

const SHYFT_API_KEY = process.env.SHYFT_API_KEY || '';

interface ShyftTokenInfo {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  mint?: string;
  address?: string;
  decimals?: number;
  current_supply?: number;
  metaplex?: {
    metadata_uri?: string;
    metadata?: {
      name?: string;
      symbol?: string;
      description?: string;
      image?: string;
    };
  };
}

async function fetchTokenFromShyft(mintAddress: string): Promise<ShyftTokenInfo | null> {
  try {
    const response = await axios.get(`https://api.shyft.to/sol/v1/token/get_info`, {
      params: {
        token_address: mintAddress,
        network: 'mainnet-beta'
      },
      headers: {
        'x-api-key': SHYFT_API_KEY
      }
    });
    
    if (response.data.success && response.data.result) {
      return response.data.result;
    }
    return null;
  } catch (error) {
    logger.error(`Failed to fetch from Shyft for ${mintAddress}`, error as Error);
    return null;
  }
}

async function updateTokenMetadata(mintAddress: string, tokenInfo: ShyftTokenInfo): Promise<void> {
  try {
    // Extract metadata
    const metadata = tokenInfo.metaplex?.metadata || {};
    const symbol = tokenInfo.symbol || metadata.symbol;
    const name = tokenInfo.name || metadata.name;
    const description = tokenInfo.description || metadata.description;
    const image = tokenInfo.image || metadata.image;
    const metadataUri = tokenInfo.metaplex?.metadata_uri;

    await db.query(`
      UPDATE tokens_unified
      SET 
        symbol = COALESCE($2, symbol),
        name = COALESCE($3, name),
        description = COALESCE($4, description),
        image_uri = COALESCE($5, image_uri),
        uri = COALESCE($6, uri),
        updated_at = NOW()
      WHERE mint_address = $1
    `, [
      mintAddress,
      symbol,
      name,
      description,
      image,
      metadataUri
    ]);
    
    logger.info(`Updated metadata for ${mintAddress}`, {
      symbol,
      name,
      hasImage: !!image
    });
  } catch (error) {
    logger.error(`Failed to update metadata for ${mintAddress}`, error as Error);
  }
}

async function fetchMissingMetadata() {
  try {
    // Get tokens without metadata
    const result = await db.query(`
      SELECT mint_address, latest_market_cap_usd
      FROM tokens_unified
      WHERE (symbol IS NULL OR symbol = '')
        AND latest_market_cap_usd > 10000
      ORDER BY latest_market_cap_usd DESC
      LIMIT 20
    `);
    
    logger.info(`Found ${result.rows.length} tokens without metadata`);
    
    for (const token of result.rows) {
      logger.info(`Fetching metadata for ${token.mint_address} ($${token.latest_market_cap_usd})`);
      
      const tokenInfo = await fetchTokenFromShyft(token.mint_address);
      
      if (tokenInfo) {
        await updateTokenMetadata(token.mint_address, tokenInfo);
      }
      
      // Rate limit: 1 request per second for Shyft free tier
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    logger.info('Metadata fetch completed');
  } catch (error) {
    logger.error('Failed to fetch missing metadata', error as Error);
  }
}

// Run immediately for the specific token
async function fetchSpecificToken() {
  const mintAddress = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';
  logger.info(`Fetching metadata for specific token: ${mintAddress}`);
  
  const tokenInfo = await fetchTokenFromShyft(mintAddress);
  
  if (tokenInfo) {
    logger.info('Fetched token info:', {
      symbol: tokenInfo.symbol,
      name: tokenInfo.name,
      hasMetaplex: !!tokenInfo.metaplex,
      hasMetadata: !!tokenInfo.metaplex?.metadata
    });
    await updateTokenMetadata(mintAddress, tokenInfo);
  }
}

// Run both
fetchSpecificToken()
  .then(() => fetchMissingMetadata())
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed', error);
    process.exit(1);
  });