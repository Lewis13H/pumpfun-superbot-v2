/**
 * Enhanced Auto Enricher
 * Uses multiple metadata sources with fallback strategy
 * Priority: GraphQL → Shyft API → Helius → On-chain
 */

import { db } from '../../database';
import { HeliusService } from './providers/helius';
import { ShyftProvider } from './providers/shyft-provider';
import { TokenCreationTimeService } from '../token-management/token-creation-time-service';
// import { graphqlMetadataEnricher } from './graphql-metadata-enricher';
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
  private shyftProvider: ShyftProvider;
  private creationTimeService: TokenCreationTimeService;
  private isRunning = false;
  private enrichmentQueue: Set<string> = new Set();
  private enrichmentInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 20; // Batch size for processing tokens
  private readonly CHECK_INTERVAL = 30000; // Check every 30 seconds
  private readonly MARKET_CAP_THRESHOLD = 8888; // Enrich all tokens above $8,888
  private lastEnrichmentTime = 0;
  private readonly MIN_ENRICHMENT_DELAY = 1000; // Minimum 1s between enrichment batches
  
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
    this.shyftProvider = ShyftProvider.getInstance();
    this.creationTimeService = TokenCreationTimeService.getInstance();
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
   * Enrich token immediately when it crosses threshold
   * Called from database service when a token hits $8,888
   */
  async enrichTokenOnThreshold(mintAddress: string, marketCapUsd: number): Promise<void> {
    console.log(chalk.magenta(`💎 Token ${mintAddress} crossed $${marketCapUsd.toFixed(0)} - immediate enrichment triggered`));
    
    // Add to front of queue
    this.enrichmentQueue.add(mintAddress);
    
    // Process immediately with single token
    try {
      const result = await this.enrichToken(mintAddress);
      if (result.source !== 'none') {
        console.log(chalk.green(`✅ Successfully enriched ${result.symbol || 'Unknown'} from ${result.source}`));
      }
    } catch (error) {
      console.error(chalk.red('Error enriching token on threshold:'), error);
    }
    
    // Remove from queue after processing
    this.enrichmentQueue.delete(mintAddress);
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
    
    // Enforce minimum delay between enrichment batches
    const timeSinceLastEnrichment = Date.now() - this.lastEnrichmentTime;
    if (timeSinceLastEnrichment < this.MIN_ENRICHMENT_DELAY) {
      await new Promise(resolve => setTimeout(resolve, this.MIN_ENRICHMENT_DELAY - timeSinceLastEnrichment));
    }
    
    // Get tokens with market caps for prioritization
    const tokensWithPriority = await this.getTokensWithPriority(Array.from(this.enrichmentQueue));
    const batch = tokensWithPriority.slice(0, this.BATCH_SIZE);
    
    console.log(chalk.cyan(`🔄 Processing batch of ${batch.length} tokens...`));
    
    try {
      // Use DAS service with priority for comprehensive metadata
      console.log(chalk.blue('🔹 Fetching metadata from Shyft DAS API...'));
      const dasBulkResults = await this.shyftProvider.getBulkMetadata(batch.map(t => t.mintAddress));
      
      // Process DAS results
      const stillNeedEnrichment: string[] = [];
      let dasSuccessCount = 0;
      
      for (const req of batch) {
        const dasData = dasBulkResults.get(req.mintAddress);
        if (dasData && (dasData.name || dasData.symbol)) {
          // Update database with comprehensive metadata
          await this.shyftProvider.storeEnrichedMetadata(dasData);
          
          this.stats.shyftSuccess++;
          this.stats.totalEnriched++;
          dasSuccessCount++;
          
          console.log(
            chalk.green('✅'),
            chalk.white(`${req.mintAddress.slice(0, 8)}...`),
            chalk.gray('→'),
            chalk.cyan(dasData.symbol || 'N/A'),
            chalk.gray(`(DAS) Score: ${dasData.metadata_score}`)
          );
          
          // Log additional extracted data
          if (dasData.current_holder_count) {
            console.log(chalk.gray(`     Holders: ${dasData.current_holder_count}`));
          }
          if (dasData.twitter || dasData.telegram || dasData.discord) {
            const socials = [];
            if (dasData.twitter) socials.push('Twitter');
            if (dasData.telegram) socials.push('Telegram');
            if (dasData.discord) socials.push('Discord');
            console.log(chalk.gray(`     Socials: ${socials.join(', ')}`));
          }
        } else {
          stillNeedEnrichment.push(req.mintAddress);
        }
      }
      
      console.log(chalk.green(`   ✅ Shyft DAS enriched ${dasSuccessCount} tokens`));
      
      // Process remaining tokens with Helius (if configured)
      if (stillNeedEnrichment.length > 0 && process.env.HELIUS_API_KEY) {
        console.log(chalk.yellow(`   🔸 ${stillNeedEnrichment.length} tokens need Helius fallback...`));
        
        for (const mint of stillNeedEnrichment) {
          await this.enrichToken(mint);
          // Delay between Helius calls
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } else if (stillNeedEnrichment.length > 0) {
        console.log(chalk.gray(`   ℹ️ ${stillNeedEnrichment.length} tokens could not be enriched (no Helius API key)`));
        this.stats.failures += stillNeedEnrichment.length;
      }
      
    } catch (error) {
      console.error(chalk.red('Bulk enrichment error:'), error);
      this.stats.failures += batch.length;
    }
    
    // Remove processed tokens from queue
    batch.forEach(req => this.enrichmentQueue.delete(req.mintAddress));
    this.stats.queueSize = this.enrichmentQueue.size;
    this.lastEnrichmentTime = Date.now();
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
      // Try Shyft DAS first (comprehensive metadata with holder counts)
      const dasMetadata = await this.shyftProvider.getTokenInfoDAS(mintAddress);
      if (dasMetadata && (dasMetadata.name || dasMetadata.symbol)) {
        // Update database with comprehensive metadata
        await db.query(`
          UPDATE tokens_unified
          SET 
            holder_count = $2,
            twitter = $3,
            telegram = $4,
            discord = $5,
            website = $6,
            metadata_score = $7,
            metadata_last_updated = NOW()
          WHERE mint_address = $1
        `, [
          dasMetadata.address,
          dasMetadata.current_holder_count,
          dasMetadata.twitter,
          dasMetadata.telegram,
          dasMetadata.discord,
          dasMetadata.website,
          dasMetadata.metadata_score
        ]);
        
        result = {
          mintAddress,
          symbol: dasMetadata.symbol,
          name: dasMetadata.name,
          description: dasMetadata.description,
          image: dasMetadata.image,
          uri: dasMetadata.uri,
          source: 'shyft',
          enrichedAt: new Date()
        };
        this.stats.shyftSuccess++;
        
        // Log additional data extracted
        if (dasMetadata.current_holder_count) {
          console.log(chalk.gray(`     Holders: ${dasMetadata.current_holder_count}`));
        }
        if (dasMetadata.twitter || dasMetadata.telegram || dasMetadata.discord) {
          const socials = [];
          if (dasMetadata.twitter) socials.push('Twitter');
          if (dasMetadata.telegram) socials.push('Telegram');
          if (dasMetadata.discord) socials.push('Discord');
          console.log(chalk.gray(`     Socials: ${socials.join(', ')}`));
        }
      } else {
        // Fallback to regular Shyft API
        const shyftMetadata = await this.shyftProvider.getTokenMetadata(mintAddress);
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
        } else if (process.env.HELIUS_API_KEY) {
          // Fallback to Helius only if API key is configured
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
        } else {
          // No Helius API key configured
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
        
        // Also fetch and update creation time
        try {
          const creationInfo = await this.creationTimeService.getTokenCreationTime(mintAddress);
          if (creationInfo) {
            await this.creationTimeService.updateTokenCreationTime(mintAddress, creationInfo);
            console.log(chalk.gray(`     Created: ${creationInfo.creationTime.toLocaleString()} (${creationInfo.source})`));
          }
        } catch (error) {
          console.error(chalk.yellow(`     Failed to fetch creation time: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
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
        const shyftData = await this.shyftProvider.getTokenMetadata(result.mintAddress);
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
  
  /**
   * Get tokens with market cap priority for enrichment
   */
  private async getTokensWithPriority(mintAddresses: string[]): Promise<Array<{ mintAddress: string; priority: number }>> {
    try {
      // Get market caps for prioritization
      const result = await db.query(`
        SELECT mint_address, latest_market_cap_usd
        FROM tokens_unified
        WHERE mint_address = ANY($1::varchar[])
      `, [mintAddresses]);
      
      // Create priority map
      const priorityMap = new Map<string, number>();
      for (const row of result.rows) {
        const marketCap = parseFloat(row.latest_market_cap_usd || '0');
        // Higher market cap = higher priority
        priorityMap.set(row.mint_address, marketCap);
      }
      
      // Sort by priority (highest market cap first)
      return mintAddresses
        .map(mintAddress => ({
          mintAddress,
          priority: priorityMap.get(mintAddress) || 0
        }))
        .sort((a, b) => b.priority - a.priority);
        
    } catch (error) {
      console.error(chalk.red('Error getting token priorities:'), error);
      // Return unsorted if error
      return mintAddresses.map(mintAddress => ({ mintAddress, priority: 0 }));
    }
  }
}