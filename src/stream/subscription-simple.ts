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
import { StreamClient } from './client';

export class SimpleSubscriptionHandler {
  private streamClient: StreamClient;
  private solPriceService: SolPriceService;
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
  private readonly MAX_SUBSCRIPTIONS_PER_WINDOW = 30;
  
  constructor() {
    this.streamClient = StreamClient.getInstance();
    this.solPriceService = SolPriceService.getInstance();
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
  
  private async cleanupStream(): Promise<void> {
    if (this.currentStream) {
      try {
        this.currentStream.cancel();
        
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            try {
              this.currentStream.destroy();
            } catch (e) {
              // Ignore destroy errors
            }
            resolve();
          }, 1000);
          
          this.currentStream.on('close', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } catch (error) {
        // Ignore cleanup errors
      } finally {
        this.currentStream = null;
      }
    }
  }
  
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Remove timestamps outside the window
    this.subscriptionTimestamps = this.subscriptionTimestamps.filter(
      timestamp => now - timestamp < this.RATE_LIMIT_WINDOW_MS
    );
    
    // Check if we're at the limit
    if (this.subscriptionTimestamps.length >= this.MAX_SUBSCRIPTIONS_PER_WINDOW) {
      const oldestTimestamp = this.subscriptionTimestamps[0];
      const waitTime = this.RATE_LIMIT_WINDOW_MS - (now - oldestTimestamp) + 1000; // Add 1s buffer
      
      console.log(`⏳ Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)}s before next subscription...`);
      await this.delay(waitTime);
    }
    
    // Record this subscription attempt
    this.subscriptionTimestamps.push(now);
  }
  
  private async runWithReconnect(): Promise<void> {
    while (this.isRunning) {
      try {
        // Enforce rate limit BEFORE creating subscription
        await this.enforceRateLimit();
        
        console.log('📡 Connecting to gRPC stream...');
        
        const args: any = {
          slots: {},
          accounts: {},
          transactions: {
            pump: {
              vote: false,
              failed: false,
              signature: undefined,
              accountInclude: [PUMP_PROGRAM],
              accountExclude: [],
              accountRequired: []
            }
          },
          transactionsStatus: {},
          entry: {},
          blocks: {},
          blocksMeta: {},
          accountsDataSlice: [],
          ping: undefined,
          commitment: CommitmentLevel.CONFIRMED
        };
        
        // Add last processed slot if we have one and haven't exceeded retry limit
        if (this.lastProcessedSlot && this.retryCount < this.MAX_RETRY_WITH_LAST_SLOT) {
          args.fromSlot = String(this.lastProcessedSlot + 1);
          console.log(`📍 Resuming from slot ${this.lastProcessedSlot + 1}`);
        } else if (this.retryCount >= this.MAX_RETRY_WITH_LAST_SLOT) {
          console.log('⚠️  Max retries with last slot reached, starting from latest');
          this.lastProcessedSlot = undefined;
          this.retryCount = 0;
        }
        
        await this.subscribe(args);
        
        // Reset retry count on successful completion
        this.retryCount = 0;
        
      } catch (error: any) {
        if (!this.isRunning) break;
        
        // Increment retry count
        this.retryCount++;
        
        // Calculate exponential backoff delay
        const backoffDelay = Math.min(
          this.INITIAL_RETRY_DELAY_MS * Math.pow(2, Math.min(this.retryCount - 1, 5)),
          this.MAX_RETRY_DELAY_MS
        );
        
        console.error(`\n❌ Stream error (attempt ${this.retryCount}):`, error.message);
        console.log(`⏳ Reconnecting in ${backoffDelay / 1000}s...`);
        
        await this.delay(backoffDelay);
      }
    }
  }
  
  private async subscribe(args: SubscribeRequest): Promise<void> {
    const client = this.streamClient.getClient();
    const stream = await client.subscribe();
    this.currentStream = stream;
    
    return new Promise((resolve, reject) => {
      stream.on("data", (data: SubscribeUpdate) => {
        this.handleData(data, stream);
      });
      
      // Create a promise that resolves when stream closes
      const streamClosed = new Promise<void>((resolveClose) => {
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
  
  async processTransaction(data: SubscribeUpdate): Promise<void> {
    // Use simple parser for trade events
    const events = this.tradeEventParser.extractTradeData(data);
    
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