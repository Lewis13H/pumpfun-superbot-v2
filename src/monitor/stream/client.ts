import { EventEmitter } from 'events';
import Client from "@triton-one/yellowstone-grpc";  // Removed CommitmentLevel
import { SubscribeRequest } from "@triton-one/yellowstone-grpc/dist/types/grpc/geyser";

interface StreamConfig {
  endpoint: string;
  token: string;
}

export class StreamClient extends EventEmitter {
  private client: Client;
  private stream: any;
  private subscriptionRequest?: SubscribeRequest;
  private lastSlot?: string;
  private hasReceivedMessages: boolean = false;
  private retryCount: number = 0;
  private readonly MAX_RETRY_WITH_LAST_SLOT = 30;
  private readonly RETRY_DELAY_MS = 1000;
  private isConnected: boolean = false;

  constructor(config?: StreamConfig) {
    super();
    
    // Use config from parameter or fall back to environment variables
    const endpoint = config?.endpoint || process.env.GRPC_URL || 'https://grpc.ams.shyft.to';
    const token = config?.token || process.env.X_TOKEN || '';
    
    // Initialize with keepalive settings
    this.client = new Client(
      endpoint,
      token,
      {
        "grpc.keepalive_permit_without_calls": 1,
        "grpc.keepalive_time_ms": 10000,
        "grpc.keepalive_timeout_ms": 1000,
        "grpc.default_compression_algorithm": 2,
      }
    );
  }

  async connect(): Promise<void> {
    console.log('🔌 StreamClient connecting...');
    this.isConnected = true;
  }

  async subscribe(subscription: SubscribeRequest): Promise<void> {
    this.subscriptionRequest = subscription;
    
    while (this.isConnected) {
      try {
        if (this.subscriptionRequest.fromSlot) {
          console.log(`Starting stream from slot ${this.subscriptionRequest.fromSlot}`);
        }
        
        await this.handleStream();
        
        // Stream ended normally, reset retry count if we received messages
        if (this.hasReceivedMessages) {
          this.retryCount = 0;
        }
        
      } catch (err: any) {
        if (!this.isConnected) break; // Exit if disconnected
        
        console.error(`Stream error, retrying in ${this.RETRY_DELAY_MS / 1000} second...`);
        await this.delay(this.RETRY_DELAY_MS);
        
        // Update retry logic based on whether we received messages
        if (err.hasReceivedMessages) {
          this.retryCount = 0;
        }
        
        // Handle slot-based retry
        if (err.lastSlot && this.retryCount < this.MAX_RETRY_WITH_LAST_SLOT) {
          console.log(
            `#${this.retryCount} retrying with last slot ${err.lastSlot}, ` +
            `remaining retries ${this.MAX_RETRY_WITH_LAST_SLOT - this.retryCount}`
          );
          this.subscriptionRequest.fromSlot = err.lastSlot;
          this.retryCount++;
        } else {
          console.log("Retrying from latest slot (no last slot available)");
          delete this.subscriptionRequest.fromSlot;
          this.retryCount = 0;
          this.lastSlot = undefined;
        }
      }
    }
  }

  private async handleStream(): Promise<void> {
    if (!this.subscriptionRequest) {
      throw new Error('No subscription request set');
    }

    this.stream = await this.client.subscribe();
    
    return new Promise((resolve, reject) => {
      this.stream.on('data', (data: any) => {
        // Track slot from transaction data
        if (data?.transaction?.slot) {
          this.lastSlot = data.transaction.slot;
          this.hasReceivedMessages = true;
        }
        this.emit('data', data);
      });

      this.stream.on('error', (err: any) => {
        // Check if this is a user-initiated cancellation
        if (err.code === 1 || err.message?.includes('Cancelled')) {
          console.log('✅ Stream cancelled by user');
          this.emit('disconnect');
          resolve();
          return;
        }
        
        // Log the error
        console.error('Stream error:', err);
        this.emit('error', err);
        
        // Properly close the stream
        this.stream.end();
        reject({
          error: err,
          lastSlot: this.lastSlot,
          hasReceivedMessages: this.hasReceivedMessages
        });
      });

      // Handle both end and close events
      const finalize = () => {
        this.emit('disconnect');
        resolve();
      };
      this.stream.on('end', finalize);
      this.stream.on('close', finalize);

      // Write subscription with error handling
      this.stream.write(this.subscriptionRequest, (err: any) => {
        if (err) {
          reject({
            error: err,
            lastSlot: this.lastSlot,
            hasReceivedMessages: this.hasReceivedMessages
          });
        }
      });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  disconnect(): void {
    console.log('🔌 StreamClient disconnecting...');
    this.isConnected = false;
    
    if (this.stream) {
      this.stream.end(); // Use end() as shown in official example
      this.stream = null;
    }
  }
}