/**
 * Recovery Queue
 * Manages the queue of tokens awaiting price recovery
 */

import { StaleToken, RecoveryBatch, RecoveryResult } from '../types/stale-detection.types';
import { v4 as uuidv4 } from 'uuid';

interface TokenBatch extends RecoveryBatch {
  tokens: StaleToken[];
}

export interface QueueItem {
  token: StaleToken;
  priority: number;
  attempts: number;
  lastAttempt?: Date;
  addedAt: Date;
}

export class RecoveryQueue {
  private queue: QueueItem[] = [];
  private processing = new Set<string>();
  private maxRetries = 3;
  private retryDelay = 60000; // 1 minute

  /**
   * Add tokens to the queue
   */
  add(tokens: StaleToken[]): void {
    const now = new Date();
    
    for (const token of tokens) {
      // Skip if already in queue or processing
      if (this.isQueued(token.mintAddress) || this.isProcessing(token.mintAddress)) {
        continue;
      }

      // Calculate priority based on market cap and staleness
      const priority = this.calculatePriority(token);

      this.queue.push({
        token,
        priority,
        attempts: 0,
        addedAt: now
      });
    }

    // Sort queue by priority (highest first)
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get next batch of tokens to recover
   */
  getNextBatch(batchSize: number): TokenBatch {
    const batch: StaleToken[] = [];
    const now = new Date();

    // Get tokens that aren't being processed and haven't exceeded retries
    for (const item of this.queue) {
      if (batch.length >= batchSize) break;

      // Skip if currently processing
      if (this.processing.has(item.token.mintAddress)) continue;

      // Skip if recently attempted
      if (item.lastAttempt) {
        const timeSinceLastAttempt = now.getTime() - item.lastAttempt.getTime();
        if (timeSinceLastAttempt < this.retryDelay) continue;
      }

      // Skip if exceeded max retries
      if (item.attempts >= this.maxRetries) continue;

      batch.push(item.token);
      this.processing.add(item.token.mintAddress);
    }

    return {
      batchId: uuidv4(),
      tokensChecked: batch.length,
      tokensRecovered: 0,
      tokensFailed: 0,
      graphqlQueries: 0,
      status: 'running' as const,
      startTime: now,
      tokens: batch
    };
  }

  /**
   * Mark tokens as completed
   */
  markCompleted(results: RecoveryResult[]): void {
    for (const result of results) {
      // Remove from processing
      this.processing.delete(result.mintAddress);

      if (result.success) {
        // Remove from queue if successful
        this.queue = this.queue.filter(item => item.token.mintAddress !== result.mintAddress);
      } else {
        // Update attempts and last attempt time
        const item = this.queue.find(q => q.token.mintAddress === result.mintAddress);
        if (item) {
          item.attempts++;
          item.lastAttempt = new Date();
        }
      }
    }
  }

  /**
   * Calculate priority for a token
   */
  private calculatePriority(token: StaleToken): number {
    let priority = 0;

    // Market cap weight (0-50 points)
    if (token.marketCapUsd) {
      if (token.marketCapUsd >= 100000) priority += 50;
      else if (token.marketCapUsd >= 50000) priority += 40;
      else if (token.marketCapUsd >= 20000) priority += 30;
      else if (token.marketCapUsd >= 10000) priority += 20;
      else if (token.marketCapUsd >= 5000) priority += 10;
    }

    // Staleness weight (0-30 points)
    const hoursStale = token.staleDuration ? token.staleDuration / 60 : 0;
    if (hoursStale >= 24) priority += 30;
    else if (hoursStale >= 12) priority += 25;
    else if (hoursStale >= 6) priority += 20;
    else if (hoursStale >= 3) priority += 15;
    else if (hoursStale >= 1) priority += 10;

    // Graduated tokens get bonus (20 points)
    // Graduated tokens get bonus if we track that
    // if (token.graduated_to_amm) {
    //   priority += 20;
    // }

    return priority;
  }

  /**
   * Check if token is already queued
   */
  isQueued(mintAddress: string): boolean {
    return this.queue.some(item => item.token.mintAddress === mintAddress);
  }

  /**
   * Check if token is currently being processed
   */
  isProcessing(mintAddress: string): boolean {
    return this.processing.has(mintAddress);
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const failedTokens = this.queue.filter(item => item.attempts >= this.maxRetries);
    const pendingTokens = this.queue.filter(item => item.attempts < this.maxRetries);

    return {
      totalQueued: this.queue.length,
      currentlyProcessing: this.processing.size,
      pendingRecovery: pendingTokens.length,
      failedRecovery: failedTokens.length,
      queueDepth: this.queue.length,
      oldestInQueue: this.queue.length > 0 
        ? new Date().getTime() - this.queue[0].addedAt.getTime() 
        : 0
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
   * Remove failed tokens from queue
   */
  clearFailed(): number {
    const before = this.queue.length;
    this.queue = this.queue.filter(item => item.attempts < this.maxRetries);
    return before - this.queue.length;
  }
}