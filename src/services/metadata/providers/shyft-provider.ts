/**
 * Unified Shyft Provider
 * Combines standard metadata service with DAS (Digital Asset Standard) API
 * Provides comprehensive token metadata, holder info, and social links
 */

import axios from 'axios';
import chalk from 'chalk';
import { db } from '../../../database';

// Standard metadata interface (from shyft-metadata-service)
interface ShyftTokenMetadata {
  address: string;
  name?: string;
  symbol?: string;
  uri?: string;
  description?: string;
  image?: string;
  creators?: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;
  supply?: number;
  decimals?: number;
  is_mutable?: boolean;
  mint_authority?: string;
  freeze_authority?: string;
}

// Extended DAS metadata interface (from shyft-das-service)
export interface TokenInfoDAS {
  // Basic token info
  address: string;
  symbol?: string;
  name?: string;
  decimals: number;
  supply: string;
  
  // Extended metadata
  description?: string;
  image?: string;
  external_url?: string;
  uri?: string;
  
  // Social links
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
  
  // Authorities
  update_authority?: string;
  freeze_authority?: string;
  mint_authority?: string;
  
  // Holder information
  current_holder_count?: number;
  top_holders?: Array<{
    owner: string;
    balance: string;
    percentage: number;
  }>;
  
  // Creator info
  creators?: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;
  
  // Additional DAS fields
  is_mutable?: boolean;
  is_compressed?: boolean;
  collection?: {
    name: string;
    family: string;
  };
  
  // Metadata completeness score
  metadata_score?: number;
}

export class ShyftProvider {
  private static instance: ShyftProvider;
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.shyft.to/sol/v1';
  private cache = new Map<string, { data: TokenInfoDAS; timestamp: number }>();
  private readonly CACHE_TTL = 3600000; // 1 hour
  private readonly RATE_LIMIT_DELAY = 200; // 200ms between requests
  private lastRequestTime = 0;
  private requestCount = 0;
  private readonly MAX_REQUESTS_PER_MINUTE = 100;
  
  // Stats tracking
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    rateLimitHits: 0,
    errors: 0,
    holderCountsExtracted: 0,
    socialLinksExtracted: 0
  };
  
  private constructor() {
    this.apiKey = process.env.SHYFT_API_KEY || process.env.SHYFT_GRPC_TOKEN || '';
    if (!this.apiKey) {
      console.warn(chalk.yellow('⚠️ SHYFT_API_KEY not found'));
    }
  }
  
  static getInstance(): ShyftProvider {
    if (!this.instance) {
      this.instance = new ShyftProvider();
    }
    return this.instance;
  }
  
  /**
   * Get basic token metadata (standard API)
   */
  async getTokenMetadata(mintAddress: string): Promise<ShyftTokenMetadata | null> {
    try {
      // Check cache first
      const cached = this.cache.get(mintAddress);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        this.stats.cacheHits++;
        // Convert DAS format to basic metadata format
        return this.convertToBasicMetadata(cached.data);
      }
      
      // Try to get from DAS first (more comprehensive)
      const dasInfo = await this.getTokenInfoDAS(mintAddress);
      if (dasInfo) {
        return this.convertToBasicMetadata(dasInfo);
      }
      
      // Fallback to standard API
      await this.enforceRateLimit();
      
      const response = await axios.get(`${this.baseUrl}/token/get_info`, {
        params: {
          network: 'mainnet-beta',
          token_address: mintAddress
        },
        headers: {
          'x-api-key': this.apiKey,
          'Accept': 'application/json'
        },
        timeout: 5000
      });
      
      if (response.data.success && response.data.result) {
        const metadata = response.data.result as ShyftTokenMetadata;
        
        // Cache as DAS format for consistency
        this.cache.set(mintAddress, {
          data: this.convertToDASFormat(metadata),
          timestamp: Date.now()
        });
        
        return metadata;
      }
      
      return null;
      
    } catch (error) {
      this.handleError('getTokenMetadata', error);
      return null;
    }
  }
  
  /**
   * Get comprehensive token info using DAS API
   */
  async getTokenInfoDAS(mintAddress: string): Promise<TokenInfoDAS | null> {
    try {
      // Check cache
      const cached = this.cache.get(mintAddress);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        this.stats.cacheHits++;
        return cached.data;
      }
      
      await this.enforceRateLimit();
      this.stats.totalRequests++;
      
      // Get basic token info
      const tokenResponse = await axios.get(`${this.baseUrl}/token/get_info`, {
        params: {
          network: 'mainnet-beta',
          token_address: mintAddress
        },
        headers: {
          'x-api-key': this.apiKey,
          'Accept': 'application/json'
        },
        timeout: 5000
      });
      
      if (!tokenResponse.data.success || !tokenResponse.data.result) {
        return null;
      }
      
      const basicInfo = tokenResponse.data.result;
      
      // Log the response to debug
      console.log('📊 Shyft API response for', mintAddress.slice(0, 8) + '...:', {
        symbol: basicInfo.symbol,
        name: basicInfo.name,
        hasData: !!basicInfo.symbol || !!basicInfo.name
      });
      
      // Get holder count
      let holderCount: number | undefined;
      try {
        const holderResponse = await axios.get(`${this.baseUrl}/token/get_holders`, {
          params: {
            network: 'mainnet-beta',
            token_address: mintAddress,
            size: 1 // Just need the count
          },
          headers: {
            'x-api-key': this.apiKey,
            'Accept': 'application/json'
          },
          timeout: 5000
        });
        
        if (holderResponse.data.success) {
          holderCount = holderResponse.data.result?.total || 0;
          if (holderCount && holderCount > 0) {
            this.stats.holderCountsExtracted++;
          }
        }
      } catch (holderError) {
        // Continue without holder count
      }
      
      // Parse metadata for social links
      const metadata = await this.fetchAndParseMetadata(basicInfo.uri);
      
      // Calculate metadata score
      const metadataScore = this.calculateMetadataScore({
        ...basicInfo,
        ...metadata,
        current_holder_count: holderCount
      });
      
      const tokenInfo: TokenInfoDAS = {
        address: mintAddress,
        symbol: basicInfo.symbol || 'Unknown',
        name: basicInfo.name || 'Unknown Token',
        decimals: basicInfo.decimals || 6,
        supply: basicInfo.supply || basicInfo.current_supply || '0',
        description: metadata?.description || basicInfo.description,
        image: metadata?.image || basicInfo.image,
        external_url: metadata?.external_url,
        uri: basicInfo.uri || basicInfo.metadata_uri,
        
        // Social links from metadata
        twitter: metadata?.twitter,
        telegram: metadata?.telegram,
        discord: metadata?.discord,
        website: metadata?.website || metadata?.external_url,
        
        // Authorities
        update_authority: basicInfo.update_authority,
        freeze_authority: basicInfo.freeze_authority,
        mint_authority: basicInfo.mint_authority,
        
        // Holder info
        current_holder_count: holderCount,
        
        // Creator info
        creators: basicInfo.creators,
        
        // Additional fields
        is_mutable: basicInfo.is_mutable,
        
        // Metadata score
        metadata_score: metadataScore
      };
      
      // Cache the result
      this.cache.set(mintAddress, {
        data: tokenInfo,
        timestamp: Date.now()
      });
      
      return tokenInfo;
      
    } catch (error) {
      this.handleError('getTokenInfoDAS', error);
      return null;
    }
  }
  
  /**
   * Bulk fetch metadata for multiple tokens
   */
  async getBulkMetadata(mintAddresses: string[]): Promise<Map<string, TokenInfoDAS>> {
    const results = new Map<string, TokenInfoDAS>();
    
    // First, check cache for all addresses
    const uncachedAddresses: string[] = [];
    for (const mint of mintAddresses) {
      const cached = this.cache.get(mint);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        results.set(mint, cached.data);
        this.stats.cacheHits++;
      } else {
        uncachedAddresses.push(mint);
      }
    }
    
    console.log(chalk.blue(`📦 ${results.size}/${mintAddresses.length} tokens found in cache`));
    
    if (uncachedAddresses.length === 0) {
      return results;
    }
    
    // Process uncached tokens with DAS API for comprehensive data
    console.log(chalk.yellow(`🔄 Fetching ${uncachedAddresses.length} tokens from Shyft API...`));
    
    // Process in parallel batches to speed up fetching
    const PARALLEL_BATCH_SIZE = 5; // Process 5 tokens simultaneously
    
    for (let i = 0; i < uncachedAddresses.length; i += PARALLEL_BATCH_SIZE) {
      const batch = uncachedAddresses.slice(i, i + PARALLEL_BATCH_SIZE);
      
      // Fetch batch in parallel
      const batchPromises = batch.map(async (mint) => {
        try {
          const metadata = await this.getTokenInfoDAS(mint);
          if (metadata) {
            results.set(mint, metadata);
          }
        } catch (error) {
          // Continue with next token on error
          if (process.env.DEBUG) {
            console.error(chalk.red(`Failed to fetch ${mint}:`), error);
          }
        }
      });
      
      // Wait for batch to complete
      await Promise.all(batchPromises);
      
      // Progress update
      const processed = Math.min(i + PARALLEL_BATCH_SIZE, uncachedAddresses.length);
      if (processed % 10 === 0 || processed === uncachedAddresses.length) {
        console.log(chalk.gray(`  Progress: ${processed}/${uncachedAddresses.length}`));
      }
    }
    
    console.log(chalk.green(`✅ Fetched ${results.size - (mintAddresses.length - uncachedAddresses.length)} new tokens from Shyft`));
    
    return results;
  }
  
  /**
   * Get holder statistics for a token
   */
  async getHolderStats(mintAddress: string): Promise<{
    count: number;
    topHolders: Array<{ owner: string; balance: string; percentage: number }>;
  } | null> {
    try {
      await this.enforceRateLimit();
      
      const response = await axios.get(`${this.baseUrl}/token/get_holders`, {
        params: {
          network: 'mainnet-beta',
          token_address: mintAddress,
          size: 10 // Top 10 holders
        },
        headers: {
          'x-api-key': this.apiKey,
          'Accept': 'application/json'
        },
        timeout: 5000
      });
      
      if (response.data.success && response.data.result) {
        const holders = response.data.result.data || [];
        const totalSupply = response.data.result.total_supply || 1;
        
        return {
          count: response.data.result.total || 0,
          topHolders: holders.map((h: any) => ({
            owner: h.owner,
            balance: h.balance,
            percentage: (parseFloat(h.balance) / totalSupply) * 100
          }))
        };
      }
      
      return null;
    } catch (error) {
      this.handleError('getHolderStats', error);
      return null;
    }
  }
  
  /**
   * Store enriched metadata in database
   */
  async storeEnrichedMetadata(tokenInfo: TokenInfoDAS): Promise<void> {
    try {
      console.log('💾 Storing metadata for', tokenInfo.address.slice(0, 8) + '...:', {
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        hasSymbol: !!tokenInfo.symbol,
        hasName: !!tokenInfo.name
      });
      
      await db.query(`
        UPDATE tokens_unified
        SET 
          symbol = COALESCE($2, symbol),
          name = COALESCE($3, name),
          uri = COALESCE($4, uri),
          image_uri = COALESCE($5, image_uri),
          description = COALESCE($6, description),
          holder_count = $7,
          twitter = $8,
          telegram = $9,
          discord = $10,
          website = $11,
          metadata_score = $12,
          metadata_enriched = true,
          metadata_enriched_at = NOW(),
          metadata_last_updated = NOW()
        WHERE mint_address = $1
      `, [
        tokenInfo.address,
        tokenInfo.symbol,
        tokenInfo.name,
        tokenInfo.uri,
        tokenInfo.image,
        tokenInfo.description,
        tokenInfo.current_holder_count,
        tokenInfo.twitter,
        tokenInfo.telegram,
        tokenInfo.discord,
        tokenInfo.website,
        tokenInfo.metadata_score
      ]);
    } catch (error) {
      console.error(chalk.red('Error storing enriched metadata:'), error);
    }
  }
  
  /**
   * Parse metadata URI for social links
   */
  private async fetchAndParseMetadata(uri?: string): Promise<any> {
    if (!uri) return null;
    
    try {
      const response = await axios.get(uri, { timeout: 3000 });
      const metadata = response.data;
      
      // Extract social links from various possible locations
      const socialLinks: any = {};
      
      // Check direct properties
      if (metadata.twitter) socialLinks.twitter = metadata.twitter;
      if (metadata.telegram) socialLinks.telegram = metadata.telegram;
      if (metadata.discord) socialLinks.discord = metadata.discord;
      if (metadata.website) socialLinks.website = metadata.website;
      
      // Check attributes array (common in NFT metadata)
      if (metadata.attributes && Array.isArray(metadata.attributes)) {
        metadata.attributes.forEach((attr: any) => {
          const traitType = (attr.trait_type || '').toLowerCase();
          if (traitType === 'twitter' && attr.value) socialLinks.twitter = attr.value;
          if (traitType === 'telegram' && attr.value) socialLinks.telegram = attr.value;
          if (traitType === 'discord' && attr.value) socialLinks.discord = attr.value;
          if (traitType === 'website' && attr.value) socialLinks.website = attr.value;
        });
      }
      
      // Check properties object
      if (metadata.properties) {
        if (metadata.properties.socials) {
          Object.assign(socialLinks, metadata.properties.socials);
        }
      }
      
      if (Object.keys(socialLinks).length > 0) {
        this.stats.socialLinksExtracted++;
      }
      
      return {
        ...socialLinks,
        description: metadata.description,
        image: metadata.image,
        external_url: metadata.external_url
      };
      
    } catch (error) {
      // URI fetch failed - common for new tokens
      return null;
    }
  }
  
  /**
   * Calculate metadata completeness score (0-100)
   */
  private calculateMetadataScore(tokenInfo: Partial<TokenInfoDAS>): number {
    let score = 0;
    const weights = {
      name: 10,
      symbol: 10,
      description: 10,
      image: 15,
      website: 10,
      twitter: 10,
      telegram: 5,
      discord: 5,
      holder_count: 15,
      creators: 10
    };
    
    if (tokenInfo.name) score += weights.name;
    if (tokenInfo.symbol) score += weights.symbol;
    if (tokenInfo.description) score += weights.description;
    if (tokenInfo.image) score += weights.image;
    if (tokenInfo.website || tokenInfo.external_url) score += weights.website;
    if (tokenInfo.twitter) score += weights.twitter;
    if (tokenInfo.telegram) score += weights.telegram;
    if (tokenInfo.discord) score += weights.discord;
    if (tokenInfo.current_holder_count && tokenInfo.current_holder_count > 0) {
      score += weights.holder_count;
    }
    if (tokenInfo.creators && tokenInfo.creators.length > 0) {
      score += weights.creators;
    }
    
    return score;
  }
  
  /**
   * Convert DAS format to basic metadata format
   */
  private convertToBasicMetadata(dasInfo: TokenInfoDAS): ShyftTokenMetadata {
    return {
      address: dasInfo.address,
      name: dasInfo.name,
      symbol: dasInfo.symbol,
      uri: dasInfo.uri,
      description: dasInfo.description,
      image: dasInfo.image,
      creators: dasInfo.creators,
      supply: dasInfo.supply ? parseInt(dasInfo.supply) : undefined,
      decimals: dasInfo.decimals,
      is_mutable: dasInfo.is_mutable,
      mint_authority: dasInfo.mint_authority,
      freeze_authority: dasInfo.freeze_authority
    };
  }
  
  /**
   * Convert basic metadata to DAS format
   */
  private convertToDASFormat(metadata: ShyftTokenMetadata): TokenInfoDAS {
    return {
      address: metadata.address,
      symbol: metadata.symbol,
      name: metadata.name,
      decimals: metadata.decimals || 6,
      supply: metadata.supply?.toString() || '0',
      description: metadata.description,
      image: metadata.image,
      uri: metadata.uri,
      update_authority: undefined,
      freeze_authority: metadata.freeze_authority,
      mint_authority: metadata.mint_authority,
      creators: metadata.creators,
      is_mutable: metadata.is_mutable,
      metadata_score: 0
    };
  }
  
  /**
   * Enforce rate limiting
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    // Reset counter every minute
    if (timeSinceLastRequest > 60000) {
      this.requestCount = 0;
    }
    
    // Check if we're approaching rate limit
    if (this.requestCount >= this.MAX_REQUESTS_PER_MINUTE) {
      const waitTime = 60000 - timeSinceLastRequest;
      if (waitTime > 0) {
        console.log(chalk.yellow(`⏳ Rate limit reached, waiting ${(waitTime / 1000).toFixed(1)}s...`));
        this.stats.rateLimitHits++;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.requestCount = 0;
      }
    }
    
    // Ensure minimum delay between requests
    if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
      await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY - timeSinceLastRequest));
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }
  
  /**
   * Handle API errors
   */
  private handleError(method: string, error: any): void {
    this.stats.errors++;
    
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 429) {
        console.error(chalk.yellow(`Shyft rate limit hit in ${method}`));
        this.stats.rateLimitHits++;
      } else if (error.response?.status === 404) {
        // Token not found - this is normal for new tokens
        return;
      }
    }
    
    if (process.env.DEBUG) {
      console.error(chalk.red(`Shyft ${method} error:`), error);
    }
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Get service statistics
   */
  getStats(): typeof ShyftProvider.prototype.stats {
    const cacheHitRate = this.stats.totalRequests > 0 
      ? (this.stats.cacheHits / (this.stats.totalRequests + this.stats.cacheHits)) * 100 
      : 0;
      
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      cacheHitRate: Math.round(cacheHitRate)
    } as any;
  }
  
  /**
   * Pre-populate cache with known metadata
   */
  populateCache(entries: Array<{ mintAddress: string; metadata: TokenInfoDAS }>): void {
    for (const entry of entries) {
      this.cache.set(entry.mintAddress, {
        data: entry.metadata,
        timestamp: Date.now()
      });
    }
    console.log(chalk.green(`✅ Pre-populated cache with ${entries.length} tokens`));
  }
}