/**
 * Recovery Queue Service
 * Manages priority queue for token price recovery
 */

import { RecoveryQueueItem, StaleToken } from '../types/stale-detection.types';
import chalk from 'chalk';

export class RecoveryQueue {
  private queue: RecoveryQueueItem[] = [];
  private processing: Set<string> = new Set();
  private maxRetries = 3;
  
  /**
   * Add tokens to recovery queue with priority
   */
  async addTokens(tokens: StaleToken[]): Promise<void> {
    const newItems = tokens
      .filter(token => !this.isQueued(token.mintAddress))
      .map(token => ({
        mintAddress: token.mintAddress,
        priority: token.priority,
        attempts: 0,
        addedAt: new Date(),
      }));
    
    this.queue.push(...newItems);
    this.sortQueue();
    
    if (newItems.length > 0) {
      console.log(chalk.blue(`📥 Added ${newItems.length} tokens to recovery queue`));
    }
  }
  
  /**
   * Get next batch of tokens for recovery
   */
  getNextBatch(batchSize: number): RecoveryQueueItem[] {
    const available = this.queue.filter(
      item => !this.processing.has(item.mintAddress) && item.attempts < this.maxRetries
    );
    
    const batch = available.slice(0, batchSize);
    
    // Mark as processing
    batch.forEach(item => {
      this.processing.add(item.mintAddress);
      item.attempts++;
      item.lastAttempt = new Date();
    });
    
    return batch;
  }
  
  /**
   * Mark tokens as completed (success or failure)
   */
  markCompleted(mintAddresses: string[], success: boolean): void {
    mintAddresses.forEach(mint => {
      this.processing.delete(mint);
      
      if (success) {
        // Remove from queue if successful
        this.queue = this.queue.filter(item => item.mintAddress !== mint);
      } else {
        // Update error count
        const item = this.queue.find(i => i.mintAddress === mint);
        if (item && item.attempts >= this.maxRetries) {
          // Remove if max retries reached
          this.queue = this.queue.filter(i => i.mintAddress !== mint);
          console.log(chalk.red(`❌ Removed ${mint} after ${this.maxRetries} failed attempts`));
        }
      }
    });
  }
  
  /**
   * Calculate priority based on market cap and stale duration
   */
  static calculatePriority(token: StaleToken): number {
    let priority = 50; // Base priority
    
    // Market cap based priority
    if (token.marketCapUsd >= 50000) {
      priority += 30;
    } else if (token.marketCapUsd >= 20000) {
      priority += 20;
    } else if (token.marketCapUsd >= 10000) {
      priority += 10;
    } else if (token.marketCapUsd >= 5000) {
      priority += 5;
    }
    
    // Stale duration based priority
    if (token.staleDuration > 120) {
      priority += 15; // Very stale (>2 hours)
    } else if (token.staleDuration > 60) {
      priority += 10; // Critical stale (>1 hour)
    } else if (token.staleDuration > 30) {
      priority += 5; // Stale (>30 minutes)
    }
    
    return Math.min(priority, 100); // Cap at 100
  }
  
  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queueDepth: this.queue.length,
      processing: this.processing.size,
      byPriority: {
        critical: this.queue.filter(i => i.priority >= 80).length,
        high: this.queue.filter(i => i.priority >= 60 && i.priority < 80).length,
        medium: this.queue.filter(i => i.priority >= 40 && i.priority < 60).length,
        low: this.queue.filter(i => i.priority < 40).length,
      },
      oldestItem: this.queue.length > 0 
        ? Math.floor((Date.now() - this.queue[this.queue.length - 1].addedAt.getTime()) / 1000 / 60)
        : 0,
    };
  }
  
  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = [];
    this.processing.clear();
  }
  
  /**
   * Check if token is already queued
   */
  private isQueued(mintAddress: string): boolean {
    return this.queue.some(item => item.mintAddress === mintAddress) ||
           this.processing.has(mintAddress);
  }
  
  /**
   * Sort queue by priority (highest first)
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => b.priority - a.priority);
  }
}