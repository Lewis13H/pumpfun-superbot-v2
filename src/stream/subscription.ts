import { 
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate 
} from '@triton-one/yellowstone-grpc';
import { PUMP_PROGRAM } from '../utils/constants';
import { SimpleTradeEventParser } from '../utils/trade-event-parser-simple';
import { calculatePrice } from '../utils/price-calculator';
import { formatOutput } from '../utils/formatters';
import { SolPriceService } from '../services/sol-price';
import { GraduationTracker } from '../services/graduation-tracker';
import { StreamClient } from './client';

export class SubscriptionHandler {
  private streamClient: StreamClient;
  private solPriceService: SolPriceService;
  private graduationTracker: GraduationTracker;
  private tradeEventParser: SimpleTradeEventParser;
  private currentStream: any = null;
  private isRunning = false;
  private lastProcessedSlot: number | undefined;
  private retryCount = 0;
  private readonly MAX_RETRY_WITH_LAST_SLOT = 30;
  private readonly INITIAL_RETRY_DELAY_MS = 2000;
  private readonly MAX_RETRY_DELAY_MS = 60000;
  private subscriptionTimestamps: number[] = [];
  private readonly RATE_LIMIT_WINDOW_MS = 60000;
  private readonly MAX_SUBSCRIPTIONS_PER_WINDOW = 30; // Stay well under 50 limit
  
  constructor() {
    this.streamClient = StreamClient.getInstance();
    this.solPriceService = SolPriceService.getInstance();
    this.graduationTracker = GraduationTracker.getInstance();
    this.tradeEventParser = new SimpleTradeEventParser();
  }
  
  async start(): Promise<void> {
    this.isRunning = true;
    await this.runWithReconnect();
  }
  
  async stop(): Promise<void> {
    console.log('\n🛑 Stopping subscription...');
    this.isRunning = false;
    
    await this.cleanupStream();
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
        await this.cleanupStream();
        
        // Calculate exponential backoff delay
        const delay = Math.min(
          this.INITIAL_RETRY_DELAY_MS * Math.pow(2, Math.min(this.retryCount, 5)),
          this.MAX_RETRY_DELAY_MS
        );
        
        console.log(`🔄 Reconnecting in ${delay}ms... (attempt ${this.retryCount + 1})`);
        await this.delay(delay);
        
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
    // Enforce rate limit BEFORE creating subscription
    await this.enforceRateLimit();
    
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
          } else if (error.code === 13) {
            // Serialization error - usually during reconnection
            console.log('⚠️  Stream serialization error (normal during reconnection)');
          } else {
            console.error("❌ Stream error:", {
              code: error.code,
              details: error.details,
              message: error.message
            });
          }
          resolveClose();
        });
        
        stream.on("end", () => {
          console.log("📡 Stream ended (server closed connection)");
          resolveClose();
        });
        
        stream.on("close", () => {
          console.log("🔌 Stream closed");
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
      // Log ping/pong to track connection health
      if (this.retryCount === 0 && Math.random() < 0.1) { // Log 10% of pings when stable
        console.log('🏓 Ping/pong keepalive');
      }
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
    // Check for graduation first
    const isGraduation = await this.graduationTracker.processMigration(data);
    if (isGraduation) {
      return; // Graduation processed, no need to process as trade
    }
    
    // Use IDL-based parser for trade events
    const events = this.tradeEventParser.extractTradeData(data);
    
    for (const event of events) {
      try {
        const solPrice = await this.solPriceService.getPrice();
        const priceData = calculatePrice(
          event.virtualSolReserves,
          event.virtualTokenReserves,
          solPrice
        );
        
        // Add buy/sell info to the output
        const tradeType = event.isBuy ? '🟢 BUY' : '🔴 SELL';
        const solAmountFormatted = (Number(event.solAmount) / 1e9).toFixed(4);
        const tokenAmountFormatted = (Number(event.tokenAmount) / 1e6).toFixed(2);
        
        console.log(`\n${tradeType} | ${event.mint}`);
        console.log(`  Amount: ${solAmountFormatted} SOL → ${tokenAmountFormatted} tokens`);
        console.log(`  Trader: ${event.user}`);
        
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
  
  private async cleanupStream(): Promise<void> {
    if (this.currentStream) {
      try {
        // Try to end the stream gracefully
        this.currentStream.end();
        // Give it a moment to close
        await this.delay(100);
      } catch (e) {
        // If end fails, try destroy
        try {
          this.currentStream.destroy();
        } catch {}
      } finally {
        this.currentStream = null;
      }
    }
  }
  
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Remove timestamps outside the rate limit window
    this.subscriptionTimestamps = this.subscriptionTimestamps.filter(
      timestamp => now - timestamp < this.RATE_LIMIT_WINDOW_MS
    );
    
    // Log current rate limit status
    console.log(`📊 Rate limit status: ${this.subscriptionTimestamps.length}/${this.MAX_SUBSCRIPTIONS_PER_WINDOW} subscriptions in last 60s`);
    
    // If we're at the rate limit, wait until we can create a new subscription
    if (this.subscriptionTimestamps.length >= this.MAX_SUBSCRIPTIONS_PER_WINDOW) {
      const oldestTimestamp = this.subscriptionTimestamps[0];
      const waitTime = (oldestTimestamp + this.RATE_LIMIT_WINDOW_MS) - now + 1000; // Add 1s buffer
      
      if (waitTime > 0) {
        console.log(`⚠️  Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)}s before reconnecting...`);
        await this.delay(waitTime);
        
        // Re-check after waiting
        return this.enforceRateLimit();
      }
    }
    
    // Record this subscription attempt
    this.subscriptionTimestamps.push(now);
    console.log(`✅ Creating subscription #${this.subscriptionTimestamps.length}`);
  }
}