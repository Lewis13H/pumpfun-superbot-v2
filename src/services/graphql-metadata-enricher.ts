/**
 * GraphQL-based Token Metadata Enricher
 * Uses Shyft's GraphQL endpoint for bulk metadata queries
 * More efficient than REST API calls
 */

import chalk from 'chalk';
// Removed unused import ShyftGraphQLClient
import { UnifiedDbServiceV2 } from '../database/unified-db-service';
// import { 
//   GET_PUMP_FUN_BONDING_CURVE_DATA,
//   GET_PUMP_FUN_ENRICHED_DATA
// } from '../graphql/queries/pump-fun.queries';

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
  // Pump.fun specific fields
  bondingCurveData?: {
    creator: string;
    tokenTotalSupply: string;
    virtualSolReserves: string;
    virtualTokenReserves: string;
    complete: boolean;
    bondingCurveKey: string;
  };
}

// interface MetadataResult {
//   pubkey: string;
//   mint?: string;
//   name?: string;
//   symbol?: string;
//   uri?: string;
//   seller_fee_basis_points?: number;
//   creators?: Array<{
//     address: string;
//     share: number;
//     verified: boolean;
//   }>;
//   primary_sale_happened?: boolean;
//   is_mutable?: boolean;
//   token_standard?: number;
// }

export class GraphQLMetadataEnricher {
  private static instance: GraphQLMetadataEnricher;
  private _dbService?: UnifiedDbServiceV2;
  
  private constructor() {
    // GraphQL client not needed - metadata disabled
  }
  
  private get dbService(): UnifiedDbServiceV2 {
    if (!this._dbService) {
      this._dbService = UnifiedDbServiceV2.getInstance();
    }
    return this._dbService;
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
  async batchFetchMetadata(_mintAddresses: string[]): Promise<Map<string, TokenMetadata>> {
    const results = new Map<string, TokenMetadata>();
    
    // GraphQL metadata fetching is disabled because Shyft GraphQL doesn't have
    // the required tables (spl_Token, Metadata). This prevents errors and lets
    // the fallback services (Shyft REST API, Helius) handle metadata enrichment.
    console.log(chalk.yellow('⚠️ GraphQL metadata disabled - using REST API fallbacks'));
    
    return results;
  }

  /**
   * NEW: Fetch pump.fun enriched data combining metadata and bonding curve info
   */
  async fetchPumpFunEnrichedData(_mintAddresses: string[]): Promise<Map<string, TokenMetadata>> {
    // Since Shyft GraphQL doesn't have spl_Token or Metadata tables,
    // we'll return an empty map and let the fallback enrichment services handle it
    // This prevents the "field 'spl_Token' not found" error
    return new Map<string, TokenMetadata>();
  }

  // Private methods removed - GraphQL metadata disabled
  
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
          // Build update query with pump.fun specific fields
          const updateFields = [
            'name = COALESCE(name, $1)',
            'symbol = COALESCE(symbol, $2)',
            'uri = COALESCE(uri, $3)',
            'metadata_source = \'graphql\'',
            'metadata_updated_at = NOW()',
            'creators = COALESCE(creators, $4::jsonb)',
            'decimals = COALESCE(decimals, $5)',
            'supply = COALESCE(supply, $6)'
          ];
          
          const params = [
            data.name,
            data.symbol,
            data.uri || null,
            data.creators ? JSON.stringify(data.creators) : null,
            data.decimals || null,
            data.supply || null
          ];
          
          // Add pump.fun specific fields if available
          if (data.bondingCurveData) {
            updateFields.push(
              'creator = COALESCE(creator, $' + (params.length + 1) + ')',
              'total_supply = COALESCE(total_supply, $' + (params.length + 2) + ')',
              'bonding_curve_key = COALESCE(bonding_curve_key, $' + (params.length + 3) + ')'
            );
            
            params.push(
              data.bondingCurveData.creator,
              data.bondingCurveData.tokenTotalSupply,
              data.bondingCurveData.bondingCurveKey
            );
          }
          
          // Add mint address as last parameter
          params.push(mintAddress);
          
          await (this.dbService as any).pool.query(
            'UPDATE tokens_unified SET ' + updateFields.join(', ') + 
            ' WHERE mint_address = $' + params.length,
            params
          );
          
          // If we have bonding curve data, also perform creator analysis
          if (data.bondingCurveData?.creator) {
            await this.analyzeCreatorIfNeeded(data.bondingCurveData.creator);
          }
          
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
    
    console.log(chalk.green(`✅ Enrichment complete: ${success} success, ${failed} failed`));
    
    return { success, failed, source: 'graphql' };
  }

  /**
   * Analyze creator if not recently analyzed
   */
  private async analyzeCreatorIfNeeded(creatorAddress: string): Promise<void> {
    try {
      // Check if creator was recently analyzed
      const result = await (this.dbService as any).pool.query(
        'SELECT analyzed_at FROM creator_analysis WHERE creator_address = $1 AND analyzed_at > NOW() - INTERVAL \'24 hours\'',
        [creatorAddress]
      );
      
      if (result.rows.length === 0) {
        // Queue for analysis (will be implemented in Phase 2)
        console.log(chalk.gray(`Creator ${creatorAddress} queued for analysis`));
      }
    } catch (error) {
      console.error('Error checking creator analysis:', error);
    }
  }
  
  /**
   * Get all tokens needing enrichment
   */
  async getTokensNeedingEnrichment(limit: number = 1000): Promise<string[]> {
    const result = await (this.dbService as any).pool.query(
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
    
    return result.rows.map((row: any) => row.mint_address);
  }
}

// Export singleton instance
export const graphqlMetadataEnricher = GraphQLMetadataEnricher.getInstance();
