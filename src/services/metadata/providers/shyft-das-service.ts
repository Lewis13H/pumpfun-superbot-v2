/**
 * Enhanced Shyft DAS Service
 * Implements comprehensive Digital Asset Standard (DAS) API integration
 * Extracts holder counts, social links, and extended metadata
 */

import axios from 'axios';
import chalk from 'chalk';
import { db } from '../../../database';

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

export class ShyftDASService {
  private static instance: ShyftDASService;
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
  
  static getInstance(): ShyftDASService {
    if (!this.instance) {
      this.instance = new ShyftDASService();
    }
    return this.instance;
  }
  
  /**
   * Get comprehensive token info using DAS API
   */
  async getTokenInfoDAS(mintAddress: string): Promise<TokenInfoDAS | null> {
    try {
      // Check cache first
      const cached = this.cache.get(mintAddress);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        this.stats.cacheHits++;
        return cached.data;
      }
      
      // Enforce rate limiting
      await this.enforceRateLimit();
      
      this.stats.totalRequests++;
      
      // Fetch comprehensive token info
      const response = await axios.get(`${this.baseUrl}/token/get_info`, {
        params: {
          network: 'mainnet-beta',
          token_address: mintAddress,
          enable_metadata: true,
          enable_owner_info: true,
          enable_supply: true
        },
        headers: {
          'x-api-key': this.apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
      
      if (!response.data.success || !response.data.result) {
        return null;
      }
      
      const data = response.data.result;
      
      // Extract social links from metadata
      const socialLinks = this.extractSocialLinks(data.metadata);
      
      // Build comprehensive token info
      const tokenInfo: TokenInfoDAS = {
        // Basic info
        address: data.address,
        symbol: data.symbol || data.metadata?.symbol,
        name: data.name || data.metadata?.name,
        decimals: data.decimals || 6,
        supply: data.supply || '0',
        
        // Extended metadata
        description: data.metadata?.description || data.description,
        image: data.metadata?.image || data.image,
        external_url: data.metadata?.external_url,
        uri: data.metadata?.uri || data.uri,
        
        // Social links
        twitter: socialLinks.twitter,
        telegram: socialLinks.telegram,
        discord: socialLinks.discord,
        website: socialLinks.website || data.metadata?.external_url,
        
        // Authorities
        update_authority: data.update_authority,
        freeze_authority: data.freeze_authority,
        mint_authority: data.mint_authority,
        
        // Holder info
        current_holder_count: data.holder_count || data.current_holders,
        top_holders: this.parseTopHolders(data.top_holders),
        
        // Creator info
        creators: data.creators || data.metadata?.creators,
        
        // Additional fields
        is_mutable: data.is_mutable,
        is_compressed: data.is_compressed,
        collection: data.collection
      };
      
      // Calculate metadata completeness score
      tokenInfo.metadata_score = this.calculateMetadataScore(tokenInfo);
      
      // Track stats
      if (tokenInfo.current_holder_count) this.stats.holderCountsExtracted++;
      if (tokenInfo.twitter || tokenInfo.telegram || tokenInfo.discord) {
        this.stats.socialLinksExtracted++;
      }
      
      // Cache the result
      this.cache.set(mintAddress, {
        data: tokenInfo,
        timestamp: Date.now()
      });
      
      return tokenInfo;
      
    } catch (error) {
      this.stats.errors++;
      
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          this.stats.rateLimitHits++;
          console.error(chalk.yellow('⚠️ Shyft rate limit hit'));
        } else if (error.response?.status === 404) {
          // Token not found - normal for new tokens
          return null;
        }
      }
      
      if (process.env.DEBUG) {
        console.error(chalk.red('❌ Shyft DAS error:'), error);
      }
      
      return null;
    }
  }
  
  /**
   * Extract social links from metadata
   */
  private extractSocialLinks(metadata: any): {
    twitter?: string;
    telegram?: string;
    discord?: string;
    website?: string;
  } {
    if (!metadata) return {};
    
    const links: any = {};
    
    // Check direct fields
    if (metadata.twitter) links.twitter = metadata.twitter;
    if (metadata.telegram) links.telegram = metadata.telegram;
    if (metadata.discord) links.discord = metadata.discord;
    if (metadata.website) links.website = metadata.website;
    
    // Check attributes array (common in NFT metadata)
    if (metadata.attributes && Array.isArray(metadata.attributes)) {
      for (const attr of metadata.attributes) {
        const trait = attr.trait_type?.toLowerCase();
        if (trait === 'twitter' || trait === 'x') {
          links.twitter = attr.value;
        } else if (trait === 'telegram') {
          links.telegram = attr.value;
        } else if (trait === 'discord') {
          links.discord = attr.value;
        } else if (trait === 'website') {
          links.website = attr.value;
        }
      }
    }
    
    // Check social_links object
    if (metadata.social_links) {
      Object.assign(links, metadata.social_links);
    }
    
    // Extract from description if present
    if (metadata.description && !links.twitter) {
      const twitterMatch = metadata.description.match(/twitter\.com\/(\w+)|x\.com\/(\w+)/i);
      if (twitterMatch) {
        links.twitter = `https://twitter.com/${twitterMatch[1] || twitterMatch[2]}`;
      }
    }
    
    return links;
  }
  
  /**
   * Parse top holders data
   */
  private parseTopHolders(holders: any): TokenInfoDAS['top_holders'] {
    if (!holders || !Array.isArray(holders)) return undefined;
    
    return holders.map(holder => ({
      owner: holder.owner || holder.address,
      balance: holder.balance || holder.amount || '0',
      percentage: holder.percentage || holder.share || 0
    })).slice(0, 10); // Top 10 holders only
  }
  
  /**
   * Calculate metadata completeness score
   */
  calculateMetadataScore(token: TokenInfoDAS): number {
    let score = 0;
    const scoreMap = {
      name: 20,
      symbol: 20,
      description: 10,
      image: 15,
      socialLinks: 15,
      holderCount: 20
    };
    
    if (token.name) score += scoreMap.name;
    if (token.symbol) score += scoreMap.symbol;
    if (token.description) score += scoreMap.description;
    if (token.image) score += scoreMap.image;
    if (token.twitter || token.telegram || token.discord) score += scoreMap.socialLinks;
    if (token.current_holder_count && token.current_holder_count > 0) score += scoreMap.holderCount;
    
    return score;
  }
  
  /**
   * Bulk fetch with priority queue
   */
  async getBulkMetadataWithPriority(
    requests: Array<{ mintAddress: string; priority: number }>
  ): Promise<Map<string, TokenInfoDAS>> {
    // Sort by priority (higher priority first)
    const sorted = requests.sort((a, b) => b.priority - a.priority);
    const results = new Map<string, TokenInfoDAS>();
    
    // Check cache first
    const uncached: typeof requests = [];
    for (const req of sorted) {
      const cached = this.cache.get(req.mintAddress);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        results.set(req.mintAddress, cached.data);
      } else {
        uncached.push(req);
      }
    }
    
    console.log(chalk.blue(`📦 ${results.size}/${requests.length} tokens found in cache`));
    
    if (uncached.length === 0) {
      return results;
    }
    
    // Process in batches to avoid overwhelming the API
    const BATCH_SIZE = 10;
    console.log(chalk.yellow(`🔄 Fetching ${uncached.length} tokens from Shyft DAS API...`));
    
    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
      const batch = uncached.slice(i, i + BATCH_SIZE);
      
      // Process batch in parallel
      const promises = batch.map(async (req) => {
        try {
          const metadata = await this.getTokenInfoDAS(req.mintAddress);
          if (metadata) {
            return { mintAddress: req.mintAddress, metadata };
          }
        } catch (error) {
          // Log but don't fail the batch
          if (process.env.DEBUG) {
            console.error(chalk.red(`Failed to fetch ${req.mintAddress}`));
          }
        }
        return null;
      });
      
      const batchResults = await Promise.all(promises);
      
      // Add successful results
      for (const result of batchResults) {
        if (result) {
          results.set(result.mintAddress, result.metadata);
        }
      }
      
      // Progress update
      const processed = Math.min(i + BATCH_SIZE, uncached.length);
      console.log(chalk.gray(`  Progress: ${processed}/${uncached.length} (${results.size} successful)`));
      
      // Small delay between batches
      if (i + BATCH_SIZE < uncached.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(chalk.green(`✅ Successfully enriched ${results.size} tokens`));
    
    return results;
  }
  
  /**
   * Update database with enriched metadata
   */
  async updateDatabaseMetadata(tokenInfo: TokenInfoDAS): Promise<void> {
    try {
      await db.query(`
        UPDATE tokens_unified
        SET 
          name = COALESCE($2, name),
          symbol = COALESCE($3, symbol),
          description = COALESCE($4, description),
          image_uri = COALESCE($5, image_uri),
          uri = COALESCE($6, uri),
          holder_count = COALESCE($7, holder_count),
          metadata_source = 'shyft_das',
          metadata_updated_at = NOW(),
          twitter = COALESCE($8, twitter),
          telegram = COALESCE($9, telegram),
          discord = COALESCE($10, discord),
          website = COALESCE($11, website),
          update_authority = COALESCE($12, update_authority),
          freeze_authority = COALESCE($13, freeze_authority),
          is_mutable = COALESCE($14, is_mutable),
          metadata_score = COALESCE($15, metadata_score)
        WHERE mint_address = $1
      `, [
        tokenInfo.address,
        tokenInfo.name,
        tokenInfo.symbol,
        tokenInfo.description,
        tokenInfo.image,
        tokenInfo.uri,
        tokenInfo.current_holder_count,
        tokenInfo.twitter,
        tokenInfo.telegram,
        tokenInfo.discord,
        tokenInfo.website,
        tokenInfo.update_authority,
        tokenInfo.freeze_authority,
        tokenInfo.is_mutable,
        tokenInfo.metadata_score
      ]);
    } catch (error) {
      console.error(chalk.red('Failed to update database:'), error);
    }
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
   * Get service statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      cacheHitRate: this.stats.totalRequests > 0 
        ? (this.stats.cacheHits / this.stats.totalRequests * 100).toFixed(2) + '%'
        : '0%',
      errorRate: this.stats.totalRequests > 0
        ? (this.stats.errors / this.stats.totalRequests * 100).toFixed(2) + '%'
        : '0%'
    };
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    console.log(chalk.green('✅ Cache cleared'));
  }
}