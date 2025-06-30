/**
 * Enhanced Auto Enricher
 * Uses multiple metadata sources with fallback strategy
 * Priority: GraphQL → Shyft API → Helius → On-chain
 */

import { db } from '../database';
import { HeliusService } from './helius';
import { ShyftMetadataService } from './shyft-metadata-service';
import { graphqlMetadataEnricher } from './graphql-metadata-enricher';
import chalk from 'chalk';

interface EnrichmentResult {
  mintAddress: string;
  symbol?: string;
  name?: string;
  description?: string;
  image?: string;
  uri?: string;
  source: 'shyft' | 'helius' | 'onchain' | 'none';
  enrichedAt: Date;
}

export class EnhancedAutoEnricher {
  private static instance: EnhancedAutoEnricher;
  private heliusService: HeliusService;
  private shyftService: ShyftMetadataService;
  private isRunning = false;
  private enrichmentQueue: Set<string> = new Set();
  private enrichmentInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 20; // Process more tokens at once
  private readonly CHECK_INTERVAL = 30000; // Check every 30 seconds
  // private readonly MAX_RETRIES = 3;
  private readonly MARKET_CAP_THRESHOLD = 8888; // Enrich all tokens above $8,888
  
  // Track statistics
  private stats = {
    totalEnriched: 0,
    shyftSuccess: 0,
    heliusSuccess: 0,
    failures: 0,
    queueSize: 0
  };
  
  private constructor() {
    this.heliusService = HeliusService.getInstance();
    this.shyftService = ShyftMetadataService.getInstance();
  }
  
  static getInstance(): EnhancedAutoEnricher {
    if (!EnhancedAutoEnricher.instance) {
      EnhancedAutoEnricher.instance = new EnhancedAutoEnricher();
    }
    return EnhancedAutoEnricher.instance;
  }
  
  async start() {
    if (this.isRunning) {
      console.log(chalk.yellow('Enhanced auto-enricher already running'));
      return;
    }
    
    console.log(chalk.cyan('🚀 Starting enhanced auto-enrichment service...'));
    this.isRunning = true;
    
    // Initial check for unknown tokens
    await this.checkForUnknownTokens();
    
    // Set up periodic checks
    this.enrichmentInterval = setInterval(async () => {
      await this.checkForUnknownTokens();
      await this.processQueue();
    }, this.CHECK_INTERVAL);
    
    // Display stats periodically
    setInterval(() => this.displayStats(), 60000); // Every minute
  }
  
  stop() {
    if (this.enrichmentInterval) {
      clearInterval(this.enrichmentInterval);
      this.enrichmentInterval = null;
    }
    this.isRunning = false;
    console.log(chalk.red('🛑 Enhanced auto-enricher stopped'));
    this.displayStats();
  }
  
  /**
   * Check for tokens that need enrichment
   * Prioritize tokens above $8,888 market cap
   */
  private async checkForUnknownTokens() {
    try {
      // Find tokens without metadata - prioritize by market cap threshold
      const result = await db.query(`
        SELECT mint_address, first_market_cap_usd 
        FROM tokens_unified 
        WHERE (symbol IS NULL OR name IS NULL OR symbol = 'Unknown' OR name = 'Unknown')
          AND first_market_cap_usd >= $1
        ORDER BY 
          CASE 
            WHEN graduated_to_amm = true THEN 1  -- AMM tokens first
            WHEN first_market_cap_usd > 50000 THEN 2
            WHEN first_market_cap_usd > 20000 THEN 3
            WHEN first_market_cap_usd > 10000 THEN 4
            ELSE 5
          END,
          created_at DESC
        LIMIT 100
      `, [this.MARKET_CAP_THRESHOLD]);
      
      for (const row of result.rows) {
        this.enrichmentQueue.add(row.mint_address);
      }
      
      this.stats.queueSize = this.enrichmentQueue.size;
      
      if (this.enrichmentQueue.size > 0) {
        console.log(chalk.blue(`📋 Found ${this.enrichmentQueue.size} tokens above $${this.MARKET_CAP_THRESHOLD} needing enrichment`));
      }
    } catch (error) {
      console.error(chalk.red('Error checking for unknown tokens:'), error);
    }
  }
  
  /**
   * Process tokens in the enrichment queue
   */
  private async processQueue() {
    if (this.enrichmentQueue.size === 0) return;
    
    const batch = Array.from(this.enrichmentQueue).slice(0, this.BATCH_SIZE);
    
    console.log(chalk.cyan(`🔄 Processing batch of ${batch.length} tokens...`));
    
    // Try GraphQL first (most efficient for bulk)
    try {
      console.log(chalk.blue('🔹 Attempting GraphQL bulk metadata fetch...'));
      const graphqlResult = await graphqlMetadataEnricher.enrichTokensInDatabase(batch);
      
      // Check which tokens were successfully enriched
      const needsFallback: string[] = [];
      for (const mint of batch) {
        const checkResult = await db.query(
          'SELECT metadata_source FROM tokens_unified WHERE mint_address = $1',
          [mint]
        );
        
        if (!checkResult.rows[0]?.metadata_source || checkResult.rows[0].metadata_source === null) {
          needsFallback.push(mint);
        }
      }
      
      console.log(chalk.green(`   ✅ GraphQL enriched ${graphqlResult.success} tokens`));
      
      if (needsFallback.length > 0) {
        console.log(chalk.yellow(`   🔸 ${needsFallback.length} tokens need fallback enrichment...`));
        
        // Try bulk Shyft API as fallback
        console.log(chalk.blue('🔹 Attempting bulk Shyft API metadata fetch...'));
        const shyftBulkResults = await this.shyftService.getBulkMetadata(needsFallback);
        
        // Process Shyft API results
        const stillNeedEnrichment: string[] = [];
        
        for (const mint of needsFallback) {
          const shyftData = shyftBulkResults.get(mint);
          if (shyftData && (shyftData.name || shyftData.symbol)) {
            // Update with Shyft data
            const result: EnrichmentResult = {
              mintAddress: mint,
              symbol: shyftData.symbol,
              name: shyftData.name,
              description: shyftData.description,
              image: shyftData.image,
              uri: shyftData.uri,
              source: 'shyft',
              enrichedAt: new Date()
            };
            
            await this.updateTokenMetadata(result);
            this.stats.shyftSuccess++;
            this.stats.totalEnriched++;
            
            console.log(
              chalk.green('✅'),
              chalk.white(`${mint.slice(0, 8)}...`),
              chalk.gray('→'),
              chalk.cyan(result.symbol || 'N/A'),
              chalk.gray('(shyft api)')
            );
          } else {
            stillNeedEnrichment.push(mint);
          }
        }
        
        // Process remaining tokens with Helius
        if (stillNeedEnrichment.length > 0) {
          console.log(chalk.yellow(`🔸 ${stillNeedEnrichment.length} tokens need Helius fallback...`));
          
          for (const mint of stillNeedEnrichment) {
            await this.enrichToken(mint);
            // Small delay between Helius calls
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }
      
    } catch (error) {
      console.error(chalk.red('Bulk enrichment error, falling back to individual:'), error);
      // Fallback to individual processing
      const promises = batch.map(mint => this.enrichToken(mint));
      await Promise.all(promises);
    }
    
    // Remove processed tokens from queue
    batch.forEach(mint => this.enrichmentQueue.delete(mint));
    this.stats.queueSize = this.enrichmentQueue.size;
  }
  
  /**
   * Enrich a single token with fallback strategy
   */
  private async enrichToken(mintAddress: string): Promise<EnrichmentResult> {
    let result: EnrichmentResult = {
      mintAddress,
      source: 'none',
      enrichedAt: new Date()
    };
    
    try {
      // Try Shyft first (more cost-effective)
      const shyftMetadata = await this.shyftService.getTokenMetadata(mintAddress);
      if (shyftMetadata && (shyftMetadata.name || shyftMetadata.symbol)) {
        result = {
          mintAddress,
          symbol: shyftMetadata.symbol,
          name: shyftMetadata.name,
          description: shyftMetadata.description,
          image: shyftMetadata.image,
          uri: shyftMetadata.uri,
          source: 'shyft',
          enrichedAt: new Date()
        };
        this.stats.shyftSuccess++;
      } else {
        // Fallback to Helius
        const heliusMetadata = await this.heliusService.getTokenMetadata(mintAddress);
        if (heliusMetadata && (heliusMetadata.name || heliusMetadata.symbol)) {
          result = {
            mintAddress,
            symbol: heliusMetadata.symbol,
            name: heliusMetadata.name,
            description: heliusMetadata.description,
            image: heliusMetadata.image,
            uri: heliusMetadata.image, // Helius uses 'image' field
            source: 'helius',
            enrichedAt: new Date()
          };
          this.stats.heliusSuccess++;
        } else {
          this.stats.failures++;
        }
      }
      
      // Update database if we got metadata
      if (result.source !== 'none') {
        await this.updateTokenMetadata(result);
        this.stats.totalEnriched++;
        
        console.log(
          chalk.green('✅'),
          chalk.white(`${mintAddress.slice(0, 8)}...`),
          chalk.gray('→'),
          chalk.cyan(result.symbol || 'N/A'),
          chalk.gray(`(${result.source})`)
        );
      }
      
    } catch (error) {
      console.error(chalk.red(`Error enriching ${mintAddress}:`), error);
      this.stats.failures++;
    }
    
    return result;
  }
  
  /**
   * Update token metadata in database
   */
  private async updateTokenMetadata(result: EnrichmentResult) {
    try {
      // First ensure we have all columns
      await this.ensureMetadataColumns();
      
      // Get additional metadata from Shyft if available
      let additionalData: any = {};
      if (result.source === 'shyft') {
        const shyftData = await this.shyftService.getTokenMetadata(result.mintAddress);
        if (shyftData) {
          additionalData = {
            creators: shyftData.creators ? JSON.stringify(shyftData.creators) : null,
            supply: shyftData.supply?.toString() || null,
            decimals: shyftData.decimals || null,
            is_mutable: shyftData.is_mutable || null,
            mint_authority: shyftData.mint_authority || null,
            freeze_authority: shyftData.freeze_authority || null
          };
        }
      }
      
      await db.query(`
        UPDATE tokens_unified
        SET 
          symbol = COALESCE(symbol, $2),
          name = COALESCE(name, $3),
          description = COALESCE(description, $4),
          image_uri = COALESCE(image_uri, $5),
          uri = COALESCE(uri, $6),
          metadata_source = $7,
          metadata_updated_at = NOW(),
          updated_at = NOW(),
          creators = COALESCE(creators, $8::jsonb),
          supply = COALESCE(supply, $9),
          decimals = COALESCE(decimals, $10),
          is_mutable = COALESCE(is_mutable, $11),
          mint_authority = COALESCE(mint_authority, $12),
          freeze_authority = COALESCE(freeze_authority, $13)
        WHERE mint_address = $1
      `, [
        result.mintAddress,
        result.symbol,
        result.name,
        result.description,
        result.image,
        result.uri,
        result.source,
        additionalData.creators,
        additionalData.supply,
        additionalData.decimals,
        additionalData.is_mutable,
        additionalData.mint_authority,
        additionalData.freeze_authority
      ]);
    } catch (error) {
      console.error(chalk.red('Error updating metadata:'), error);
    }
  }
  
  /**
   * Ensure all metadata columns exist
   */
  private async ensureMetadataColumns(): Promise<void> {
    try {
      await db.query(`
        ALTER TABLE tokens_unified 
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS image_uri VARCHAR(500),
        ADD COLUMN IF NOT EXISTS uri VARCHAR(500),
        ADD COLUMN IF NOT EXISTS metadata_source VARCHAR(50),
        ADD COLUMN IF NOT EXISTS metadata_updated_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS creators JSONB,
        ADD COLUMN IF NOT EXISTS supply NUMERIC(40,0),
        ADD COLUMN IF NOT EXISTS decimals INTEGER,
        ADD COLUMN IF NOT EXISTS is_mutable BOOLEAN,
        ADD COLUMN IF NOT EXISTS mint_authority VARCHAR(64),
        ADD COLUMN IF NOT EXISTS freeze_authority VARCHAR(64)
      `);
    } catch (error) {
      // Columns might already exist
    }
  }
  
  /**
   * Manually enrich specific tokens
   */
  async enrichTokens(mintAddresses: string[]): Promise<Map<string, EnrichmentResult>> {
    const results = new Map<string, EnrichmentResult>();
    
    console.log(chalk.cyan(`📦 Manually enriching ${mintAddresses.length} tokens...`));
    
    for (const mint of mintAddresses) {
      const result = await this.enrichToken(mint);
      results.set(mint, result);
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
  }
  
  /**
   * Display enrichment statistics
   */
  private displayStats() {
    console.log(chalk.cyan.bold('\n📊 Enrichment Statistics'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.white(`Total Enriched: ${this.stats.totalEnriched}`));
    console.log(chalk.green(`Shyft Success: ${this.stats.shyftSuccess}`));
    console.log(chalk.blue(`Helius Success: ${this.stats.heliusSuccess}`));
    console.log(chalk.red(`Failures: ${this.stats.failures}`));
    console.log(chalk.yellow(`Queue Size: ${this.stats.queueSize}`));
    console.log(chalk.gray('─'.repeat(40)));
  }
  
  /**
   * Get current statistics
   */
  getStats() {
    return { ...this.stats };
  }
  
  /**
   * Enrich token immediately when it crosses threshold
   * Called by database service when saving tokens
   */
  async enrichTokenOnThreshold(mintAddress: string, marketCapUsd: number): Promise<void> {
    if (marketCapUsd >= this.MARKET_CAP_THRESHOLD) {
      console.log(chalk.green(`💎 Token ${mintAddress} crossed $${this.MARKET_CAP_THRESHOLD} threshold - enriching immediately`));
      
      // Add to queue with high priority
      this.enrichmentQueue.add(mintAddress);
      
      // Process immediately
      const result = await this.enrichToken(mintAddress);
      
      if (result.source !== 'none') {
        console.log(chalk.green(`✅ Successfully enriched ${result.symbol || 'Unknown'} from ${result.source}`));
      }
      
      // Remove from queue after processing
      this.enrichmentQueue.delete(mintAddress);
    }
  }
  
  /**
   * Add tokens to enrichment queue
   */
  async addTokens(mintAddresses: string[]): Promise<void> {
    for (const mint of mintAddresses) {
      this.enrichmentQueue.add(mint);
    }
    
    console.log(chalk.blue(`📝 Added ${mintAddresses.length} tokens to enrichment queue`));
    
    // Process immediately if not already running
    if (!this.isRunning) {
      await this.processQueue();
    }
  }
}