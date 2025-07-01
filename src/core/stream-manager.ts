/**
 * Stream Manager
 * Manages a single gRPC stream shared by multiple monitors
 * This prevents hitting subscription rate limits
 */

import { SubscribeRequest, CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { EventBus, EVENTS } from './event-bus';
import { Logger } from './logger';
import chalk from 'chalk';

export interface StreamManagerOptions {
  streamClient: any; // yellowstone-grpc Client instance
  eventBus: EventBus;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
}

export class StreamManager {
  private logger: Logger;
  private stream?: any;
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private lastSubscriptionTime: number = 0;
  private subscribedPrograms: Set<string> = new Set();
  private monitorConfigs: Map<string, any> = new Map();

  constructor(private options: StreamManagerOptions) {
    this.logger = new Logger({ context: 'StreamManager', color: chalk });
  }

  /**
   * Add a program to monitor with its subscription config
   */
  async subscribeTo(programId: string, subscriptionConfig?: any): Promise<void> {
    this.logger.debug(`Adding program ${programId} to subscriptions`);
    this.subscribedPrograms.add(programId);
    
    // Store the subscription config if provided
    if (subscriptionConfig) {
      this.monitorConfigs.set(programId, subscriptionConfig);
    }
    
    // Start the stream if not already running
    if (!this.isRunning) {
      this.logger.info('Starting shared stream...');
      await this.start();
      this.logger.info('Shared stream started');
    } else {
      this.logger.debug('Stream already running');
    }
  }

  /**
   * Start the shared stream
   */
  async start(): Promise<void> {
    if (this.isRunning && this.stream) {
      this.logger.debug('Stream already running');
      return;
    }

    this.isRunning = true;
    await this.startMonitoring();
  }

  /**
   * Stop the stream
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.stream) {
      try {
        this.logger.info('Stopping shared stream...');
        this.stream.cancel();
        if (typeof this.stream.end === 'function') {
          this.stream.end();
        }
        if (typeof this.stream.destroy === 'function') {
          this.stream.destroy();
        }
        this.stream = null;
      } catch (error: any) {
        if (error.code !== "ERR_STREAM_PREMATURE_CLOSE") {
          this.logger.error('Error stopping stream', error as Error);
        }
      }
    }
  }

  /**
   * Main monitoring loop
   */
  private async startMonitoring(_reconnectDelay?: number): Promise<void> {
    if (!this.isRunning) return;

    // Unused parameters commented out
    // reconnectDelay parameter is not used in favor of handleReconnect logic

    // Rate limit subscriptions
    const timeSinceLastSub = Date.now() - this.lastSubscriptionTime;
    if (timeSinceLastSub < 2000) {
      const waitTime = 2000 - timeSinceLastSub;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    try {
      this.lastSubscriptionTime = Date.now();
      
      // Build combined subscription request for all programs
      const request = this.buildSubscribeRequest();
      
      this.logger.info('Creating shared gRPC stream for programs', {
        programs: Array.from(this.subscribedPrograms)
      });
      
      this.stream = await this.options.streamClient.subscribe();

      // Send the subscription request
      await new Promise<void>((resolve, reject) => {
        this.stream.write(request, (err: any) => {
          if (err === null || err === undefined) {
            this.logger.info('Connected to shared gRPC stream');
            this.reconnectAttempts = 0;
            resolve();
          } else {
            reject(err);
          }
        });
      });

      // Process stream data
      this.stream.on('data', async (data: any) => {
        if (!this.isRunning) return;

        try {
          // Emit raw data for all monitors to process
          this.options.eventBus.emit(EVENTS.STREAM_DATA, data);
        } catch (error) {
          this.logger.error('Error processing stream data', error as Error);
        }
      });

      // Handle stream end in background (don't block)
      this.stream.on('end', () => {
        this.logger.info('Stream ended');
        if (this.isRunning) {
          this.handleReconnect();
        }
      });
      
      this.stream.on('error', (error: any) => {
        this.logger.error('Stream error', error);
        if (this.isRunning) {
          this.handleReconnect();
        }
      });
      
      // Stream is now running in background
      return;

    } catch (error) {
      this.logger.error('Stream connection error', error as Error);
      
      if (!this.isRunning) return;

      this.handleReconnect(error as Error);
    }
  }

  /**
   * Handle reconnection with backoff
   */
  private handleReconnect(error?: Error | any): void {
    if (!this.isRunning) return;
    
    const delay = this.options.reconnectDelay || 5000;
    const maxDelay = this.options.maxReconnectDelay || 60000;
    
    // Handle rate limit errors with longer delay
    let nextDelay = Math.min(delay * Math.pow(2, this.reconnectAttempts), maxDelay);
    
    if (error?.message?.includes('RESOURCE_EXHAUSTED') || error?.message?.includes('Max subscriptions')) {
      this.logger.error('Rate limit hit! Waiting 60 seconds before retry...');
      nextDelay = 60000;
    } else if (error?.message?.includes('PERMISSION_DENIED')) {
      this.logger.error('Connection limit reached! Waiting 5 minutes...');
      nextDelay = 300000; // 5 minutes
    }

    this.logger.warn(`Reconnecting in ${nextDelay / 1000}s...`);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.startMonitoring(nextDelay);
    }, nextDelay);
  }

  /**
   * Build combined subscribe request for all programs
   */
  private buildSubscribeRequest(): SubscribeRequest {
    // If monitors provided their own configs, merge them
    if (this.monitorConfigs.size > 0) {
      const mergedConfig: any = {
        commitment: CommitmentLevel.CONFIRMED,
        accountsDataSlice: [],
        accounts: {},
        slots: {},
        transactions: {},
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        ping: undefined
      };
      
      // Merge all monitor configurations
      for (const [, config] of this.monitorConfigs) {
        // Merge transactions
        if (config.transactions) {
          Object.assign(mergedConfig.transactions, config.transactions);
        }
        // Merge accounts
        if (config.accounts) {
          Object.assign(mergedConfig.accounts, config.accounts);
        }
        // Merge other fields if needed
        if (config.slots) {
          Object.assign(mergedConfig.slots, config.slots);
        }
      }
      
      this.logger.info('Using merged subscription config from monitors', {
        transactionKeys: Object.keys(mergedConfig.transactions),
        accountKeys: Object.keys(mergedConfig.accounts)
      });
      
      return mergedConfig;
    }
    
    // Fallback to default transaction-based subscriptions
    const transactions: any = {};
    
    for (const programId of this.subscribedPrograms) {
      transactions[`prog_${programId.substring(0, 8)}`] = {
        vote: false,
        failed: false,
        signature: undefined,
        accountInclude: [programId],
        accountExclude: [],
        accountRequired: []
      };
    }

    const request: SubscribeRequest = {
      commitment: CommitmentLevel.CONFIRMED,
      accountsDataSlice: [],
      accounts: {},
      slots: {},
      transactions,
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      ping: undefined
    };

    return request;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      hasActiveStream: !!this.stream,
      reconnectAttempts: this.reconnectAttempts,
      subscribedPrograms: this.subscribedPrograms.size
    };
  }
}