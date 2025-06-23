// src/monitor/services/cache.ts

import { TokenMetadata } from '../types';
import { CACHE_CLEANUP_INTERVAL, METADATA_CACHE_TTL } from '../constants';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class CacheService {
  private knownTokens = new Set<string>();
  private tokenMetadataCache = new Map<string, CacheEntry<TokenMetadata>>();
  private progressMilestones = new Map<string, number>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.startCleanupTimer();
  }

  // Known tokens management
  addKnownToken(address: string): void {
    this.knownTokens.add(address);
  }

  isKnownToken(address: string): boolean {
    return this.knownTokens.has(address);
  }

  setKnownTokens(tokens: string[]): void {
    this.knownTokens.clear();
    tokens.forEach(token => this.knownTokens.add(token));
  }

  getKnownTokensCount(): number {
    return this.knownTokens.size;
  }

  // Token metadata management
  setTokenMetadata(address: string, metadata: TokenMetadata): void {
    this.tokenMetadataCache.set(address, {
      data: metadata,
      timestamp: Date.now()
    });
  }

  getTokenMetadata(address: string): TokenMetadata | null {
    const entry = this.tokenMetadataCache.get(address);
    if (!entry) return null;

    // Check if cache entry is still valid
    if (Date.now() - entry.timestamp > METADATA_CACHE_TTL) {
      this.tokenMetadataCache.delete(address);
      return null;
    }

    return entry.data;
  }

  getMetadataCacheSize(): number {
    return this.tokenMetadataCache.size;
  }

  // Progress milestones management
  setProgressMilestone(tokenMint: string, progress: number): void {
    this.progressMilestones.set(tokenMint, progress);
  }

  getProgressMilestone(tokenMint: string): number {
    return this.progressMilestones.get(tokenMint) || 0;
  }

  hasGraduated(tokenMint: string): boolean {
    return this.progressMilestones.has(tokenMint + '_graduated');
  }

  markGraduated(tokenMint: string): void {
    this.progressMilestones.set(tokenMint + '_graduated', 100);
  }

  getMilestonesCount(): number {
    return this.progressMilestones.size;
  }

  // Cleanup methods
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredMetadata();
    }, CACHE_CLEANUP_INTERVAL);
  }

  private cleanupExpiredMetadata(): void {
    const now = Date.now();
    const expiredTokens: string[] = [];

    this.tokenMetadataCache.forEach((entry, address) => {
      if (now - entry.timestamp > METADATA_CACHE_TTL) {
        expiredTokens.push(address);
      }
    });

    expiredTokens.forEach(address => {
      this.tokenMetadataCache.delete(address);
    });

    if (expiredTokens.length > 0) {
      console.log(`🧹 Cleaned up ${expiredTokens.length} expired metadata entries`);
    }
  }

  cleanup(): void {
    // Clear old entries but keep structure
    const recentTokens = new Set<string>();
    const now = Date.now();

    // Keep only recent metadata
    this.tokenMetadataCache.forEach((entry, address) => {
      if (now - entry.timestamp < METADATA_CACHE_TTL) {
        recentTokens.add(address);
      }
    });

    // Clear and rebuild
    const tempCache = new Map<string, CacheEntry<TokenMetadata>>();
    recentTokens.forEach(address => {
      const entry = this.tokenMetadataCache.get(address);
      if (entry) {
        tempCache.set(address, entry);
      }
    });

    this.tokenMetadataCache = tempCache;
    console.log(`🧹 Cache cleanup: kept ${this.tokenMetadataCache.size} metadata entries`);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}