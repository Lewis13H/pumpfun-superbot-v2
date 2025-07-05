/**
 * Subscription Rate Limiter
 * Ensures we don't exceed Shyft's limit of 100 subscriptions per 60 seconds
 */

import { Logger } from '../../core/logger';

const logger = new Logger({ context: 'SubscriptionRateLimiter' });

export class SubscriptionRateLimiter {
  private subscriptions: Array<{ timestamp: number; connectionId: string }> = [];
  private readonly MAX_SUBSCRIPTIONS = 100;
  private readonly TIME_WINDOW = 60000; // 60 seconds
  
  constructor() {
    // Clean up old entries every 10 seconds
    setInterval(() => this.cleanup(), 10000);
  }
  
  /**
   * Check if we can create a new subscription
   */
  canSubscribe(): boolean {
    this.cleanup();
    const allowed = this.subscriptions.length < this.MAX_SUBSCRIPTIONS;
    
    if (!allowed) {
      const oldestSubscription = this.subscriptions[0];
      const timeUntilSlotFree = oldestSubscription 
        ? (oldestSubscription.timestamp + this.TIME_WINDOW - Date.now()) / 1000
        : 0;
        
      logger.warn(`Subscription rate limit reached! ${this.subscriptions.length}/${this.MAX_SUBSCRIPTIONS} in last 60s. Next slot in ${timeUntilSlotFree.toFixed(1)}s`);
    }
    
    return allowed;
  }
  
  /**
   * Wait until we can subscribe
   */
  async waitForSlot(): Promise<void> {
    while (!this.canSubscribe()) {
      // Wait 1 second and check again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  /**
   * Record a new subscription
   */
  recordSubscription(connectionId: string): void {
    this.subscriptions.push({ 
      timestamp: Date.now(),
      connectionId 
    });
    
    logger.debug(`Subscription recorded for ${connectionId}. Total: ${this.subscriptions.length}/${this.MAX_SUBSCRIPTIONS}`);
  }
  
  /**
   * Get current subscription rate
   */
  getCurrentRate(): { count: number; limit: number; percentage: number } {
    this.cleanup();
    const count = this.subscriptions.length;
    const percentage = (count / this.MAX_SUBSCRIPTIONS) * 100;
    
    return {
      count,
      limit: this.MAX_SUBSCRIPTIONS,
      percentage
    };
  }
  
  /**
   * Get subscriptions by connection
   */
  getConnectionStats(): Map<string, number> {
    this.cleanup();
    const stats = new Map<string, number>();
    
    for (const sub of this.subscriptions) {
      const count = stats.get(sub.connectionId) || 0;
      stats.set(sub.connectionId, count + 1);
    }
    
    return stats;
  }
  
  /**
   * Remove subscriptions older than the time window
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.TIME_WINDOW;
    const before = this.subscriptions.length;
    this.subscriptions = this.subscriptions.filter(s => s.timestamp > cutoff);
    const removed = before - this.subscriptions.length;
    
    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} expired subscriptions`);
    }
  }
  
  /**
   * Reset all subscriptions (for testing)
   */
  reset(): void {
    this.subscriptions = [];
    logger.info('Rate limiter reset');
  }
}