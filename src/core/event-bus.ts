/**
 * Event Bus for decoupled communication between components
 */

export type EventHandler<T = any> = (data: T) => void | Promise<void>;
export type UnsubscribeFn = () => void;

export interface EventSubscription {
  event: string;
  handler: EventHandler;
  once?: boolean;
}

export class EventBus {
  private events = new Map<string, Set<EventSubscription>>();
  private asyncQueue: Array<{ event: string; data: any }> = [];
  private processing = false;

  /**
   * Subscribe to an event
   */
  on<T = any>(event: string, handler: EventHandler<T>): UnsubscribeFn {
    const subscription: EventSubscription = { event, handler };
    
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    
    this.events.get(event)!.add(subscription);
    
    // Return unsubscribe function
    return () => {
      const subscriptions = this.events.get(event);
      if (subscriptions) {
        subscriptions.delete(subscription);
        if (subscriptions.size === 0) {
          this.events.delete(event);
        }
      }
    };
  }

  /**
   * Subscribe to an event once
   */
  once<T = any>(event: string, handler: EventHandler<T>): UnsubscribeFn {
    const subscription: EventSubscription = { 
      event, 
      handler,
      once: true 
    };
    
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    
    this.events.get(event)!.add(subscription);
    
    return () => {
      const subscriptions = this.events.get(event);
      if (subscriptions) {
        subscriptions.delete(subscription);
      }
    };
  }

  /**
   * Emit an event synchronously
   */
  emit<T = any>(event: string, data: T): void {
    const subscriptions = this.events.get(event);
    if (!subscriptions) return;

    const toRemove: EventSubscription[] = [];
    
    for (const subscription of Array.from(subscriptions)) {
      try {
        subscription.handler(data);
        
        if (subscription.once) {
          toRemove.push(subscription);
        }
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    }
    
    // Remove one-time subscriptions
    for (const subscription of toRemove) {
      subscriptions.delete(subscription);
    }
  }

  /**
   * Emit an event asynchronously
   */
  async emitAsync<T = any>(event: string, data: T): Promise<void> {
    const subscriptions = this.events.get(event);
    if (!subscriptions) return;

    const toRemove: EventSubscription[] = [];
    const promises: Promise<void>[] = [];
    
    for (const subscription of Array.from(subscriptions)) {
      promises.push(
        Promise.resolve(subscription.handler(data))
          .then(() => {
            if (subscription.once) {
              toRemove.push(subscription);
            }
          })
          .catch(error => {
            console.error(`Error in async event handler for ${event}:`, error);
          })
      );
    }
    
    await Promise.all(promises);
    
    // Remove one-time subscriptions
    for (const subscription of toRemove) {
      subscriptions.delete(subscription);
    }
  }

  /**
   * Queue an event for processing (useful for high-throughput scenarios)
   */
  queue<T = any>(event: string, data: T): void {
    this.asyncQueue.push({ event, data });
    this.processQueue();
  }

  /**
   * Process queued events
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.asyncQueue.length === 0) return;
    
    this.processing = true;
    
    while (this.asyncQueue.length > 0) {
      const batch = this.asyncQueue.splice(0, 100); // Process in batches
      
      await Promise.all(
        batch.map(({ event, data }) => 
          this.emitAsync(event, data).catch(error => 
            console.error(`Error processing queued event ${event}:`, error)
          )
        )
      );
    }
    
    this.processing = false;
  }

  /**
   * Remove all listeners for an event
   */
  off(event: string): void {
    this.events.delete(event);
  }

  /**
   * Remove all listeners
   */
  clear(): void {
    this.events.clear();
    this.asyncQueue = [];
  }
  
  /**
   * Remove all listeners (alias for clear)
   */
  removeAllListeners(): void {
    this.clear();
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: string): number {
    return this.events.get(event)?.size || 0;
  }

  /**
   * Get all registered events
   */
  eventNames(): string[] {
    return Array.from(this.events.keys());
  }
}

// Event types for type safety
export const EVENTS = {
  // Trade events
  BC_TRADE: 'bc:trade',
  AMM_TRADE: 'amm:trade',
  TRADE_PROCESSED: 'trade:processed',
  
  // Token events
  TOKEN_DISCOVERED: 'token:discovered',
  TOKEN_GRADUATED: 'token:graduated',
  TOKEN_THRESHOLD_CROSSED: 'token:threshold_crossed',
  TOKEN_METADATA_UPDATED: 'token:metadata_updated',
  BONDING_CURVE_CREATED: 'bonding_curve:created',
  GRADUATION_PROCESSED: 'graduation:processed',
  
  // Pool events
  POOL_CREATED: 'pool:created',
  POOL_STATE_UPDATED: 'pool:state_updated',
  
  // Liquidity events
  LIQUIDITY_ADDED: 'liquidity:added',
  LIQUIDITY_REMOVED: 'liquidity:removed',
  LIQUIDITY_PROCESSED: 'liquidity:processed',
  
  // Fee events
  FEE_COLLECTED: 'fee:collected',
  PROTOCOL_FEE_COLLECTED: 'protocol_fee:collected',
  FEE_PROCESSED: 'fee:processed',
  
  // Price events
  PRICE_UPDATED: 'price:updated',
  SOL_PRICE_UPDATED: 'sol_price:updated',
  
  // System events
  MONITOR_STARTED: 'monitor:started',
  MONITOR_STOPPED: 'monitor:stopped',
  MONITOR_ERROR: 'monitor:error',
  MONITOR_STATS_UPDATED: 'monitor:stats_updated',
  
  // Stream events
  STREAM_DATA: 'stream:data',
  
  // WebSocket events
  WS_CLIENT_CONNECTED: 'ws:client_connected',
  WS_CLIENT_DISCONNECTED: 'ws:client_disconnected',
  WS_BROADCAST: 'ws:broadcast',
} as const;

export type EventType = typeof EVENTS[keyof typeof EVENTS];