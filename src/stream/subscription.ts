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
  
  constructor() {
    this.streamClient = StreamClient.getInstance();
    this.solPriceService = SolPriceService.getInstance();
  }
  
  async start(): Promise<void> {
    const request = this.createSubscriptionRequest();
    await this.subscribeCommand(request);
  }
  
  private createSubscriptionRequest(): SubscribeRequest {
    return {
      transactions: {
        pumpfun: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [PUMP_PROGRAM],
          accountExclude: [],
          accountRequired: [],
        },
      },
      accounts: {},
      slots: {},
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.CONFIRMED,
    };
  }
  
  private async subscribeCommand(args: SubscribeRequest): Promise<void> {
    const client = this.streamClient.getClient();
    const stream = await client.subscribe();
    
    // Set up stream handlers
    stream.on("data", (data: SubscribeUpdate) => {
      this.handleData(data, stream);
    });
    
    stream.on("error", (error) => {
      console.error("ERROR:", error);
      stream.end();
      
      // Reconnect after error
      setTimeout(() => {
        console.log("Attempting to reconnect...");
        this.subscribeCommand(args);
      }, 5000);
    });
    
    stream.on("end", () => {
      console.log("Stream ended");
    });
    
    stream.on("close", () => {
      console.log("Stream closed");
    });
    
    // Send subscription request
    await new Promise<void>((resolve, reject) => {
      stream.write(args, (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    }).catch((err) => {
      console.error("Failed to write subscription request:", err);
      throw err;
    });
  }
  
  private handleData(data: SubscribeUpdate, stream: any): void {
    // Handle ping/pong
    if (data.ping) {
      stream.write({
        ping: {
          id: data.ping.id,
        },
      });
      return;
    }
    
    // Process transaction
    if (data.transaction) {
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
}