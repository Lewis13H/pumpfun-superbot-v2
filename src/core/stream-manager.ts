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
  private stats = {
    messagesReceived: 0,
    lastMessageTime: null as Date | null,
    connectionStatus: 'disconnected' as 'connected' | 'disconnected' | 'reconnecting'
  };

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
    this.stats.connectionStatus = 'disconnected';
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.stream) {
      try {
        this.logger.info('Stopping shared stream...');
        
        // Use Shyft's recommended pattern for closing streams
        await new Promise<void>((resolve, reject) => {
          // Set up listeners before canceling
          this.stream.on("error", (err: any) => {
            if (err.code === 1 || err.message.includes("Cancelled")) {
              // User cancellation, not an error
              resolve();
            } else {
              reject(err);
            }
          });
          
          this.stream.on("close", () => resolve());
          this.stream.on("end", () => resolve());
          
          // Cancel the stream
          this.stream.cancel();
          
          // Also try end/destroy as fallback
          if (typeof this.stream.end === 'function') {
            this.stream.end();
          }
          
          // Set a timeout to ensure we don't hang
          setTimeout(() => resolve(), 5000);
        });
        
        this.stream = null;
        this.logger.info('Stream closed successfully');
      } catch (error: any) {
        if (error.code !== "ERR_STREAM_PREMATURE_CLOSE" && 
            error.code !== 1 && 
            !error.message?.includes("Cancelled")) {
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

      // Log request details for debugging (only if needed)
      // console.log('About to send subscription request');
      // console.log('Full request:', JSON.stringify(request, null, 2));
      
      // Send the subscription request
      await new Promise<void>((resolve, reject) => {
        try {
          // Ensure request is properly formed before sending
          const safeRequest = JSON.parse(JSON.stringify(request));
          this.stream.write(safeRequest, (err: any) => {
            if (err === null || err === undefined) {
              this.logger.info('Connected to shared gRPC stream');
              this.reconnectAttempts = 0;
              this.stats.connectionStatus = 'connected';
              resolve();
            } else {
              reject(err);
            }
          });
        } catch (error) {
          console.error('Error preparing request:', error);
          reject(error);
        }
      });

      // Process stream data
      this.stream.on('data', async (data: any) => {
        if (!this.isRunning) return;

        try {
          
          this.stats.messagesReceived++;
          this.stats.lastMessageTime = new Date();
          
          // Emit raw data for all monitors to process
          this.options.eventBus.emit(EVENTS.STREAM_DATA, data);
        } catch (error) {
          this.logger.error('Error processing stream data', error as Error);
        }
      });

      // Handle stream end in background (don't block)
      this.stream.on('end', () => {
        this.logger.info('Stream ended');
        this.stats.connectionStatus = 'disconnected';
        if (this.isRunning) {
          this.handleReconnect();
        }
      });
      
      this.stream.on('error', (error: any) => {
        // Don't log cancellation errors when stopping
        if (!this.isRunning && 
            (error.code === 1 || 
             error.message?.includes('Cancelled') ||
             error.message?.includes('ERR_STREAM_PREMATURE_CLOSE'))) {
          return;
        }
        
        this.logger.error('Stream error', error);
        this.stats.connectionStatus = 'disconnected';
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
    this.stats.connectionStatus = 'reconnecting';

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
        accountKeys: Object.keys(mergedConfig.accounts),
        transactions: mergedConfig.transactions
      });
      
      // Convert account subscriptions to proper gRPC format
      const accounts: any = {};
      if (mergedConfig.accounts) {
        for (const [key, accountConfig] of Object.entries(mergedConfig.accounts)) {
          const accConfig = accountConfig as any;
          // Build account subscription with only the fields that are provided
          const accSub: any = {
            // Always include both account and owner fields (empty arrays if not provided)
            account: accConfig.account || [],
            owner: accConfig.owner || [],
            filters: accConfig.filters || []
          };
          
          accounts[key] = accSub;
        }
      }
      
      // Convert transaction subscriptions to proper gRPC format
      const transactions: any = {};
      if (mergedConfig.transactions) {
        for (const [key, txConfig] of Object.entries(mergedConfig.transactions)) {
          const txCfg = txConfig as any;
          // Use the config directly - no filter wrapper needed
          const txSub: any = {
            vote: txCfg.vote !== undefined ? txCfg.vote : false,
            failed: txCfg.failed !== undefined ? txCfg.failed : false,
            signature: undefined, // Explicitly set signature to undefined as required by gRPC
            accountInclude: txCfg.accountInclude || [],
            accountExclude: txCfg.accountExclude || [],
            accountRequired: txCfg.accountRequired || []
          };
          
          transactions[key] = txSub;
        }
      }
      
      // Build proper gRPC request
      const request: any = {
        commitment: CommitmentLevel.CONFIRMED,
        accounts,
        slots: mergedConfig.slots || {},
        transactions,
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        accountsDataSlice: []
      };
      
      // Log the full request for debugging
      this.logger.info('Full subscription request:', {
        request: JSON.stringify(request, null, 2)
      });
      
      return request;
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

    const request: any = {
      commitment: CommitmentLevel.CONFIRMED,
      accounts: {},
      slots: {},
      transactions,
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: []
    };

    this.logger.info('Built subscription request', {
      hasTransactions: Object.keys(transactions).length > 0,
      transactionKeys: Object.keys(transactions),
      request: JSON.stringify(request, null, 2)
    });

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
      subscribedPrograms: this.subscribedPrograms.size,
      messagesReceived: this.stats.messagesReceived,
      lastMessageTime: this.stats.lastMessageTime,
      connectionStatus: this.stats.connectionStatus
    };
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      status: this.stats.connectionStatus,
      isConnected: this.stats.connectionStatus === 'connected',
      messagesReceived: this.stats.messagesReceived,
      lastMessageTime: this.stats.lastMessageTime
    };
  }
}