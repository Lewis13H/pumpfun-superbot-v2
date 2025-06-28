/**
 * Bonding Curve Token Enricher
 * 
 * Enriches newly detected tokens with metadata and analysis
 */

import { PublicKey } from '@solana/web3.js';
import { NewMintDetection } from '../handlers/bc-mint-detector';
import chalk from 'chalk';

/**
 * Enriched token data
 */
export interface EnrichedTokenData {
  mint: string;
  creator: string;
  createdAt: Date;
  metadata: {
    name?: string;
    symbol?: string;
    uri?: string;
    description?: string;
    image?: string;
  };
  creatorProfile: {
    address: string;
    tokenCount: number;
    firstSeen: Date;
    lastSeen: Date;
    reputation: 'new' | 'regular' | 'prolific' | 'suspicious';
  };
  riskFactors: {
    isFirstToken: boolean;
    hasMetadata: boolean;
    hasValidUri: boolean;
    creatorTokenCount: number;
    suspiciousPatterns: string[];
  };
  initialMetrics: {
    supply: number;
    holders: number;
    initialPrice?: number;
    initialMarketCap?: number;
  };
}

/**
 * Creator tracking info
 */
interface CreatorInfo {
  address: string;
  tokenCount: number;
  tokens: string[];
  firstSeen: Date;
  lastSeen: Date;
  rugCount: number;
}

/**
 * Token enrichment service
 */
export class BondingCurveTokenEnricher {
  private creators: Map<string, CreatorInfo> = new Map();
  private enrichedTokens: Map<string, EnrichedTokenData> = new Map();
  private stats = {
    tokensEnriched: 0,
    uniqueCreators: 0,
    suspiciousTokens: 0,
    metadataFound: 0
  };

  /**
   * Enrich a newly detected token
   */
  async enrichToken(
    detection: NewMintDetection,
    priceData?: { priceInUsd: number; marketCapUsd: number }
  ): Promise<EnrichedTokenData> {
    // Update creator tracking
    this.updateCreatorInfo(detection);
    
    // Get creator profile
    const creatorProfile = this.getCreatorProfile(detection.creator);
    
    // Analyze risk factors
    const riskFactors = this.analyzeRiskFactors(detection, creatorProfile);
    
    // Build enriched data
    const enrichedData: EnrichedTokenData = {
      mint: detection.mintAddress,
      creator: detection.creator,
      createdAt: detection.blockTime || new Date(),
      metadata: {
        name: detection.metadata?.name,
        symbol: detection.metadata?.symbol,
        uri: detection.metadata?.uri,
        // Additional metadata would be fetched from URI in production
      },
      creatorProfile,
      riskFactors,
      initialMetrics: {
        supply: detection.initialSupply || 1_000_000_000, // Default 1B
        holders: 1, // Creator initially
        initialPrice: priceData?.priceInUsd,
        initialMarketCap: priceData?.marketCapUsd
      }
    };
    
    // Store enriched data
    this.enrichedTokens.set(detection.mintAddress, enrichedData);
    
    // Update stats
    this.stats.tokensEnriched++;
    if (detection.metadata) {
      this.stats.metadataFound++;
    }
    if (riskFactors.suspiciousPatterns.length > 0) {
      this.stats.suspiciousTokens++;
    }
    
    return enrichedData;
  }

  /**
   * Update creator tracking information
   */
  private updateCreatorInfo(detection: NewMintDetection): void {
    const creator = detection.creator;
    
    if (!this.creators.has(creator)) {
      this.creators.set(creator, {
        address: creator,
        tokenCount: 0,
        tokens: [],
        firstSeen: detection.blockTime || new Date(),
        lastSeen: detection.blockTime || new Date(),
        rugCount: 0
      });
      this.stats.uniqueCreators++;
    }
    
    const info = this.creators.get(creator)!;
    info.tokenCount++;
    info.tokens.push(detection.mintAddress);
    info.lastSeen = detection.blockTime || new Date();
  }

  /**
   * Get creator profile with reputation
   */
  private getCreatorProfile(creator: string): EnrichedTokenData['creatorProfile'] {
    const info = this.creators.get(creator);
    
    if (!info) {
      return {
        address: creator,
        tokenCount: 0,
        firstSeen: new Date(),
        lastSeen: new Date(),
        reputation: 'new'
      };
    }
    
    // Determine reputation based on activity
    let reputation: EnrichedTokenData['creatorProfile']['reputation'] = 'new';
    
    if (info.rugCount > 0) {
      reputation = 'suspicious';
    } else if (info.tokenCount > 10) {
      reputation = 'prolific';
    } else if (info.tokenCount > 1) {
      reputation = 'regular';
    }
    
    return {
      address: creator,
      tokenCount: info.tokenCount,
      firstSeen: info.firstSeen,
      lastSeen: info.lastSeen,
      reputation
    };
  }

  /**
   * Analyze risk factors for a token
   */
  private analyzeRiskFactors(
    detection: NewMintDetection,
    creatorProfile: EnrichedTokenData['creatorProfile']
  ): EnrichedTokenData['riskFactors'] {
    const suspiciousPatterns: string[] = [];
    
    // Check for suspicious patterns
    if (!detection.metadata?.name && !detection.metadata?.symbol) {
      suspiciousPatterns.push('No metadata');
    }
    
    if (creatorProfile.tokenCount > 5) {
      const timeDiff = creatorProfile.lastSeen.getTime() - creatorProfile.firstSeen.getTime();
      const hoursActive = timeDiff / (1000 * 60 * 60);
      const tokensPerHour = creatorProfile.tokenCount / Math.max(hoursActive, 1);
      
      if (tokensPerHour > 1) {
        suspiciousPatterns.push('High token creation rate');
      }
    }
    
    if (detection.metadata?.uri && !this.isValidUri(detection.metadata.uri)) {
      suspiciousPatterns.push('Invalid metadata URI');
    }
    
    return {
      isFirstToken: creatorProfile.tokenCount === 1,
      hasMetadata: !!detection.metadata,
      hasValidUri: !!detection.metadata?.uri && this.isValidUri(detection.metadata.uri),
      creatorTokenCount: creatorProfile.tokenCount,
      suspiciousPatterns
    };
  }

  /**
   * Validate metadata URI
   */
  private isValidUri(uri: string): boolean {
    try {
      const url = new URL(uri);
      return ['http:', 'https:', 'ipfs:'].includes(url.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Log enriched token details
   */
  logEnrichedToken(enrichedData: EnrichedTokenData): void {
    const { metadata, creatorProfile, riskFactors, initialMetrics } = enrichedData;
    
    console.log(chalk.cyan('\n📋 Token Analysis:'));
    console.log(chalk.gray('─'.repeat(50)));
    
    // Metadata
    if (metadata.name || metadata.symbol) {
      console.log(`Token: ${chalk.white(metadata.name || 'Unknown')} (${chalk.yellow(metadata.symbol || 'N/A')})`);
    }
    
    // Creator info
    console.log(`Creator: ${chalk.cyan(creatorProfile.address.slice(0, 8) + '...')}`);
    console.log(`  Reputation: ${this.getReputationColor(creatorProfile.reputation)}`);
    console.log(`  Tokens created: ${chalk.yellow(creatorProfile.tokenCount)}`);
    
    // Risk assessment
    if (riskFactors.suspiciousPatterns.length > 0) {
      console.log(chalk.red('\n⚠️  Risk Factors:'));
      riskFactors.suspiciousPatterns.forEach(pattern => {
        console.log(`  - ${pattern}`);
      });
    } else if (riskFactors.isFirstToken) {
      console.log(chalk.green('\n✅ First token from creator'));
    } else {
      console.log(chalk.green('\n✅ No suspicious patterns detected'));
    }
    
    // Initial metrics
    if (initialMetrics.initialMarketCap) {
      console.log(`\nInitial Market Cap: ${chalk.green('$' + initialMetrics.initialMarketCap.toFixed(2))}`);
    }
    
    console.log(chalk.gray('─'.repeat(50)));
  }

  /**
   * Get reputation color
   */
  private getReputationColor(reputation: string): string {
    switch (reputation) {
      case 'new':
        return chalk.blue(reputation.toUpperCase());
      case 'regular':
        return chalk.green(reputation.toUpperCase());
      case 'prolific':
        return chalk.yellow(reputation.toUpperCase());
      case 'suspicious':
        return chalk.red(reputation.toUpperCase());
      default:
        return chalk.white(reputation.toUpperCase());
    }
  }

  /**
   * Mark a token as rugged (for tracking)
   */
  markAsRugged(mint: string): void {
    const enrichedData = this.enrichedTokens.get(mint);
    if (enrichedData) {
      const creatorInfo = this.creators.get(enrichedData.creator);
      if (creatorInfo) {
        creatorInfo.rugCount++;
      }
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      creatorStats: {
        total: this.creators.size,
        new: Array.from(this.creators.values()).filter(c => c.tokenCount === 1).length,
        regular: Array.from(this.creators.values()).filter(c => c.tokenCount > 1 && c.tokenCount <= 5).length,
        prolific: Array.from(this.creators.values()).filter(c => c.tokenCount > 5).length,
        suspicious: Array.from(this.creators.values()).filter(c => c.rugCount > 0).length
      }
    };
  }

  /**
   * Get top creators by token count
   */
  getTopCreators(limit: number = 10): CreatorInfo[] {
    return Array.from(this.creators.values())
      .sort((a, b) => b.tokenCount - a.tokenCount)
      .slice(0, limit);
  }
}