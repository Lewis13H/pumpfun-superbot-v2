import { 
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate 
} from '@triton-one/yellowstone-grpc';
import { PUMP_PROGRAM } from '../utils/constants';
import { extractTradeEvents } from '../utils/parser';
import { calculatePrice } from '../utils/price-calculator';
import { formatOutput } from '../utils/formatter';
import { SolPriceService } from '../services/sol-price';
import { StreamClient } from './client';

export class SubscriptionHandler {
  private streamClient: StreamClient;
  private solPriceService: SolPriceService;
  private currentStream: any = null;
  private isRunning = false;
  private lastProcessedSlot: number | undefined;
  private retryCount = 0;
  private readonly MAX_RETRY_WITH_LAST_SLOT = 30;
  private readonly RETRY_DELAY_MS = 1000;
  
  constructor() {
    this.streamClient = StreamClient.getInstance();
    this.solPriceService = SolPriceService.getInstance();
  }
  
  async start(): Promise<void> {
    this.isRunning = true;
    await this.runWithReconnect();
  }
  
  async stop(): Promise<void> {
    console.log('\n🛑 Stopping subscription...');
    this.isRunning = false;
    
    if (this.currentStream) {
      try {
        this.currentStream.cancel();
        this.currentStream = null;
      } catch (error) {
        console.error('Error cancelling stream:', error);
      }
    }
  }
  
  async updateSubscription(newRequest: SubscribeRequest): Promise<void> {
    if (!this.currentStream) {
      console.error('No active stream to update');
      return;
    }
    
    try {
      console.log('🔄 Updating subscription...');
      this.currentStream.write(newRequest);
      console.log('✅ Subscription updated successfully');
    } catch (error) {
      console.error('Failed to update subscription:', error);
    }
  }
  
  private async runWithReconnect(): Promise<void> {
    while (this.isRunning) {
      try {
        const request = this.createSubscriptionRequest();
        await this.subscribeCommand(request);
      } catch (error: any) {
        if (!this.isRunning) break;
        
        // Only log non-serialization errors
        if (error.code !== 13) {
          console.error('Connection error:', error.message || error);
        }
        
        // Ensure stream is cleaned up
        if (this.currentStream) {
          try {
            this.currentStream.end();
          } catch {}
          this.currentStream = null;
        }
        
        console.log(`🔄 Reconnecting in ${this.RETRY_DELAY_MS}ms... (attempt ${this.retryCount + 1})`);
        await this.delay(this.RETRY_DELAY_MS);
        
        this.retryCount++;
        
        // Reset slot tracking after max retries
        if (this.retryCount > this.MAX_RETRY_WITH_LAST_SLOT && this.lastProcessedSlot) {
          console.log('📍 Resetting to latest slot after max retries');
          this.lastProcessedSlot = undefined;
        }
      }
    }
  }
  
  private createSubscriptionRequest(): SubscribeRequest {
    const request: any = {
      accounts: {},
      slots: {},
      transactions: {
        pumpfun: {
          vote: false,
          failed: false,
          accountInclude: [PUMP_PROGRAM],
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED,
    };
    
    // Add fromSlot if we have a last processed slot
    // Following Shyft's reconnect example pattern
    if (this.lastProcessedSlot && this.retryCount < this.MAX_RETRY_WITH_LAST_SLOT) {
      request.fromSlot = String(this.lastProcessedSlot + 1);
      console.log(`📍 Resuming from slot ${this.lastProcessedSlot + 1}`);
    } else if (this.retryCount >= this.MAX_RETRY_WITH_LAST_SLOT) {
      // Reset after max retries
      delete request.fromSlot;
      this.lastProcessedSlot = undefined;
      console.log('📍 Resetting to latest slot after max retries');
    }
    
    return request;
  }
  
  private async subscribeCommand(args: SubscribeRequest): Promise<void> {
    const client = this.streamClient.getClient();
    const stream = await client.subscribe();
    this.currentStream = stream;
    
    return new Promise((resolve, reject) => {
      const streamClosed = new Promise<void>((resolveClose) => {
        stream.on("data", (data: SubscribeUpdate) => {
          this.handleData(data, stream);
          // Reset retry count on successful data reception
          this.retryCount = 0;
        });
        
        stream.on("error", (error: any) => {
          // Check if error is due to user cancellation
          if (error.code === 1) {
            console.log('✅ Stream cancelled successfully');
          } else if (error.code !== 13) { // Don't log serialization errors
            console.error("Stream error:", error);
          }
          resolveClose();
        });
        
        stream.on("end", () => {
          console.log("Stream ended");
          resolveClose();
        });
        
        stream.on("close", () => {
          console.log("Stream closed");
          resolveClose();
        });
      });
      
      // Send subscription request
      stream.write(args, (err: any) => {
        if (err) {
          reject(err);
        } else {
          console.log('✅ Subscription started successfully');
          // Wait for stream to close
          streamClosed.then(() => {
            this.currentStream = null;
            resolve();
          });
        }
      });
    });
  }
  
  private handleData(data: SubscribeUpdate, stream: any): void {
    // Handle ping/pong
    if (data.ping) {
      stream.write({
        pong: { id: (data.ping as any).id }
      } as any);
      return;
    }
    
    // Process transaction
    if (data.transaction) {
      // Update last processed slot
      if (data.transaction.slot) {
        this.lastProcessedSlot = Number(data.transaction.slot);
      }
      
      this.processTransaction(data);
    }
  }
  
  private async processTransaction(data: SubscribeUpdate): Promise<void> {
    const logs = data.transaction?.transaction?.meta?.logMessages || [];
    const events = extractTradeEvents(logs);
    
    for (const event of events) {
      try {
        const solPrice = await this.solPriceService.getPrice();
        const priceData = calculatePrice(
          event.virtualSolReserves,
          event.virtualTokenReserves,
          solPrice
        );
        formatOutput(event.mint, priceData);
      } catch (error) {
        // Fallback with default price
        const priceData = calculatePrice(
          event.virtualSolReserves,
          event.virtualTokenReserves,
          180
        );
        formatOutput(event.mint, priceData);
      }
    }
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}