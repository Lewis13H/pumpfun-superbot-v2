/**
 * GraphQL-based Token Metadata Enricher
 * Uses Shyft's GraphQL endpoint for bulk metadata queries
 * More efficient than REST API calls
 */

import chalk from 'chalk';
import { ShyftGraphQLClient } from './graphql-client';
import { unifiedDBService } from '../database/unified-db-service';

interface TokenMetadata {
  mintAddress: string;
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  uri?: string;
  decimals?: number;
  supply?: string;
  creators?: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;
}

interface MetadataResult {
  pubkey: string;
  mint?: string;
  name?: string;
  symbol?: string;
  uri?: string;
  seller_fee_basis_points?: number;
  creators?: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;
  primary_sale_happened?: boolean;
  is_mutable?: boolean;
  token_standard?: number;
}

export class GraphQLMetadataEnricher {
  private static instance: GraphQLMetadataEnricher;
  private graphqlClient: ShyftGraphQLClient;
  private readonly BATCH_SIZE = 50; // GraphQL can handle larger batches
  
  private constructor() {
    this.graphqlClient = ShyftGraphQLClient.getInstance();
  }
  
  static getInstance(): GraphQLMetadataEnricher {
    if (!this.instance) {
      this.instance = new GraphQLMetadataEnricher();
    }
    return this.instance;
  }
  
  /**
   * Batch fetch metadata for multiple tokens via GraphQL
   */
  async batchFetchMetadata(mintAddresses: string[]): Promise<Map<string, TokenMetadata>> {
    const results = new Map<string, TokenMetadata>();
    
    console.log(chalk.blue('🔍 Fetching metadata for ' + mintAddresses.length + ' tokens via GraphQL...'));
    
    // Process in batches
    for (let i = 0; i < mintAddresses.length; i += this.BATCH_SIZE) {
      const batch = mintAddresses.slice(i, i + this.BATCH_SIZE);
      
      try {
        // Try Metaplex metadata first (most tokens have this)
        const metaplexData = await this.fetchMetaplexMetadata(batch);
        
        // For tokens without Metaplex metadata, try SPL token data
        const missingMints = batch.filter(mint => !metaplexData.has(mint));
        if (missingMints.length > 0) {
          const splData = await this.fetchSPLTokenData(missingMints);
          
          // Merge results
          splData.forEach((data, mint) => {
            metaplexData.set(mint, data);
          });
        }
        
        // Add to results
        metaplexData.forEach((data, mint) => {
          results.set(mint, data);
        });
        
        console.log(chalk.green('✅ Fetched batch ' + (Math.floor(i / this.BATCH_SIZE) + 1) + '/' + Math.ceil(mintAddresses.length / this.BATCH_SIZE)));
        
      } catch (error) {
        console.error(chalk.red('Error fetching batch:'), error);
      }
      
      // Small delay between batches
      if (i + this.BATCH_SIZE < mintAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }
  
  /**
   * Fetch Metaplex metadata via GraphQL
   */
  private async fetchMetaplexMetadata(mintAddresses: string[]): Promise<Map<string, TokenMetadata>> {
    const results = new Map<string, TokenMetadata>();
    
    try {
      const query = 'query GetMetaplexMetadata($mints: [String!]) {' +
        ' Metadata(' +
        '   where: { mint: { _in: $mints } }' +
        ' ) {' +
        '   pubkey' +
        '   mint' +
        '   name' +
        '   symbol' +
        '   uri' +
        '   seller_fee_basis_points' +
        '   creators {' +
        '     address' +
        '     share' +
        '     verified' +
        '   }' +
        '   primary_sale_happened' +
        '   is_mutable' +
        '   token_standard' +
        ' }' +
        '}';
      
      const response = await this.graphqlClient.query<{ Metadata: MetadataResult[] }>(
        query,
        { mints: mintAddresses }
      );
      
      if (response.Metadata) {
        for (const metadata of response.Metadata) {
          if (metadata.mint) {
            results.set(metadata.mint, {
              mintAddress: metadata.mint,
              name: metadata.name,
              symbol: metadata.symbol,
              uri: metadata.uri,
              creators: metadata.creators
            });
          }
        }
      }
      
    } catch (error) {
      console.error(chalk.yellow('Metaplex metadata query failed:'), error);
    }
    
    return results;
  }
  
  /**
   * Fetch SPL token data via GraphQL
   */
  private async fetchSPLTokenData(mintAddresses: string[]): Promise<Map<string, TokenMetadata>> {
    const results = new Map<string, TokenMetadata>();
    
    try {
      const query = 'query GetSPLTokens($mints: [String!]) {' +
        ' spl_Token(' +
        '   where: { pubkey: { _in: $mints } }' +
        ' ) {' +
        '   pubkey' +
        '   decimals' +
        '   supply' +
        '   mint_authority' +
        '   freeze_authority' +
        ' }' +
        '}';
      
      const response = await this.graphqlClient.query<{ 
        spl_Token: Array<{
          pubkey: string;
          decimals: number;
          supply: string;
          mint_authority?: string;
          freeze_authority?: string;
        }> 
      }>(query, { mints: mintAddresses });
      
      if (response.spl_Token) {
        for (const token of response.spl_Token) {
          // Generate basic metadata from mint address
          const shortAddress = token.pubkey.slice(0, 4) + '...' + token.pubkey.slice(-4);
          
          results.set(token.pubkey, {
            mintAddress: token.pubkey,
            name: 'Token ' + shortAddress,
            symbol: shortAddress.toUpperCase(),
            decimals: token.decimals,
            supply: token.supply
          });
        }
      }
      
    } catch (error) {
      console.error(chalk.yellow('SPL token query failed:'), error);
    }
    
    return results;
  }
  
  /**
   * Enrich tokens in database using GraphQL
   */
  async enrichTokensInDatabase(mintAddresses: string[]): Promise<{
    success: number;
    failed: number;
    source: 'graphql';
  }> {
    const metadata = await this.batchFetchMetadata(mintAddresses);
    
    let success = 0;
    let failed = 0;
    
    for (const [mintAddress, data] of metadata.entries()) {
      try {
        if (data.name && data.symbol) {
          await unifiedDBService['pool'].query(
            'UPDATE tokens_unified ' +
            'SET ' +
            '  name = COALESCE(name, $1), ' +
            '  symbol = COALESCE(symbol, $2), ' +
            '  uri = COALESCE(uri, $3), ' +
            '  metadata_source = \'graphql\', ' +
            '  metadata_updated_at = NOW(), ' +
            '  creators = COALESCE(creators, $4::jsonb), ' +
            '  decimals = COALESCE(decimals, $5), ' +
            '  supply = COALESCE(supply, $6) ' +
            'WHERE mint_address = $7',
            [
            data.name,
            data.symbol,
            data.uri || null,
            data.creators ? JSON.stringify(data.creators) : null,
            data.decimals || null,
            data.supply || null,
            mintAddress
          ]);
          
          success++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(chalk.red('Failed to update ' + mintAddress + ':'), error);
        failed++;
      }
    }
    
    // Handle tokens not found in GraphQL
    const notFound = mintAddresses.filter(mint => !metadata.has(mint));
    failed += notFound.length;
    
    return { success, failed, source: 'graphql' };
  }
  
  /**
   * Get all tokens needing enrichment
   */
  async getTokensNeedingEnrichment(limit: number = 1000): Promise<string[]> {
    const result = await unifiedDBService['pool'].query(
      'SELECT mint_address ' +
      'FROM tokens_unified ' +
      'WHERE ' +
      '  first_market_cap_usd >= 8888 ' +
      '  AND ( ' +
      '    symbol IS NULL OR ' +
      '    name IS NULL OR ' +
      '    symbol = \'Unknown\' OR ' +
      '    name = \'Unknown\' OR ' +
      '    metadata_source IS NULL OR ' +
      '    metadata_source != \'graphql\' ' +
      '  ) ' +
      'ORDER BY ' +
      '  graduated_to_amm DESC, ' +
      '  first_market_cap_usd DESC ' +
      'LIMIT $1',
      [limit]);
    
    return result.rows.map(row => row.mint_address);
  }
}

// Export singleton instance
export const graphqlMetadataEnricher = GraphQLMetadataEnricher.getInstance();
