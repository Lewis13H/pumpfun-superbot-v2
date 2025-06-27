import { 
  CommitmentLevel, 
  SubscribeRequest,
  SubscribeUpdate 
} from '@triton-one/yellowstone-grpc';
import { StreamClient } from './client';
import { SimpleTradeEventParser } from '../utils/trade-event-parser-simple';
import { AmmSwapParser, AmmSwapEvent } from '../parsers/amm-swap-parser';
import { PUMP_PROGRAM, PUMP_SWAP_PROGRAM } from '../utils/constants';
import { calculatePrice } from '../utils/price-calculator';
import bs58 from 'bs58';

// Extended trade event type with additional fields
export interface SimpleTradeEvent {
  mint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp: Date;  // Changed from bigint to Date
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  price: number;
  symbol?: string;
  signature: string;
  slot: bigint;
}

export type DualProgramEvent = 
  | { type: 'bonding_curve', event: SimpleTradeEvent }
  | { type: 'amm_swap', event: AmmSwapEvent };

interface DualProgramCallbacks {
  onTransaction: (event: DualProgramEvent) => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export class DualProgramSubscription {
  private streamClient: StreamClient;
  private currentStream: any = null;
  private callbacks: DualProgramCallbacks;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 30;
  private reconnectDelay = 1000;
  private lastProcessedSlot: number | undefined;
  private bondingCurveParser: SimpleTradeEventParser;
  private ammParser: AmmSwapParser;

  constructor(callbacks: DualProgramCallbacks) {
    this.callbacks = callbacks;
    this.streamClient = StreamClient.getInstance();
    this.bondingCurveParser = new SimpleTradeEventParser();
    this.ammParser = new AmmSwapParser();
  }

  async subscribe(startSlot?: number): Promise<void> {
    try {
      console.log(`🔄 Starting dual-program subscription (Bonding Curve + AMM)...`);
      console.log(`📍 Bonding Curve Program: ${PUMP_PROGRAM}`);
      console.log(`📍 AMM Program: ${PUMP_SWAP_PROGRAM}`);

      // Create subscription request with both programs
      const request: SubscribeRequest = {
        slots: {},
        accounts: {},
        transactions: {
          dual_pump: {
            vote: false,
            failed: false,
            accountInclude: [PUMP_PROGRAM, PUMP_SWAP_PROGRAM], // Both programs
            accountExclude: [],
            accountRequired: [],
          },
        },
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
        commitment: CommitmentLevel.CONFIRMED,
        entry: {},
        transactionsStatus: {},
      };

      // Set start slot if provided
      const slot = startSlot || this.lastProcessedSlot;
      if (slot !== undefined) {
        // slots field expects an object with filtering options
        request.slots = {};
        console.log(`📍 Starting from slot: ${slot}`);
      }

      const client = await this.streamClient.getClient();
      this.currentStream = await client.subscribe();

      // Handle stream data
      this.currentStream.on('data', async (data: SubscribeUpdate) => {
        try {
          // Debug: log transaction updates only
          if (data.transaction && data.transaction.transaction) {
            console.log('📦 Transaction update received!');
          }
          
          if (data.transaction) {
            const txUpdate = data.transaction;
            const slot = txUpdate.slot ? parseInt(txUpdate.slot) : undefined;
            
            if (slot) {
              this.lastProcessedSlot = slot;
            }

            if (txUpdate.transaction?.transaction) {
              const tx = txUpdate.transaction;
              const signature = bs58.encode(tx.signature || new Uint8Array());
              
              // Determine which program this transaction belongs to
              const programId = this.getTransactionProgramId(tx.transaction);
              
              // Debug: log program detection
              if (programId) {
                console.log(`🔍 Transaction for program: ${programId}`);
              } else {
                console.log(`❌ No matching program found for transaction ${signature}`);
                // Log the programs in the transaction for debugging
                const message = tx.transaction?.message;
                if (message?.accountKeys && message?.instructions) {
                  const programIds = new Set<string>();
                  for (const ix of message.instructions) {
                    if (ix.programIdIndex < message.accountKeys.length) {
                      const programKey = message.accountKeys[ix.programIdIndex];
                      const programIdStr = typeof programKey === 'string' 
                        ? programKey 
                        : bs58.encode(programKey as unknown as Uint8Array);
                      programIds.add(programIdStr);
                    }
                  }
                  console.log(`   Programs in tx: ${Array.from(programIds).join(', ')}`);
                }
              }
              
              if (programId === PUMP_PROGRAM) {
                // Parse as bonding curve trade
                const logs = tx.meta?.logMessages || [];
                console.log(`   Parsing ${logs.length} log messages for trade events...`);
                const events = this.bondingCurveParser.parseTradeEvents(logs);
                console.log(`   Found ${events.length} trade events`);
                
                for (const event of events) {
                  // Calculate price
                  const priceData = calculatePrice(
                    event.virtualSolReserves,
                    event.virtualTokenReserves,
                    180 // Default SOL price, will be updated in monitor
                  );
                  
                  const enrichedEvent: SimpleTradeEvent = {
                    mint: event.mint,
                    solAmount: event.solAmount,
                    tokenAmount: event.tokenAmount,
                    isBuy: event.isBuy,
                    user: event.user,
                    timestamp: new Date(Number(event.timestamp) * 1000),
                    virtualSolReserves: event.virtualSolReserves,
                    virtualTokenReserves: event.virtualTokenReserves,
                    realSolReserves: event.realSolReserves,
                    realTokenReserves: event.realTokenReserves,
                    price: priceData.priceInSol,
                    signature: signature,
                    slot: BigInt(slot || 0),
                  };
                  
                  this.callbacks.onTransaction({
                    type: 'bonding_curve',
                    event: enrichedEvent
                  });
                }
              } else if (programId === PUMP_SWAP_PROGRAM) {
                // Parse as AMM swap
                console.log(`   Parsing AMM swap transaction...`);
                // Pass the whole tx object which contains both transaction and meta
                const event = this.ammParser.parseTransaction(
                  tx,
                  signature,
                  slot?.toString() || '0',
                  Math.floor(Date.now() / 1000).toString()
                );
                
                if (event) {
                  console.log(`   ✅ AMM swap parsed: ${event.type} ${event.tokenAmount} tokens for ${event.solAmount} SOL`);
                  this.callbacks.onTransaction({
                    type: 'amm_swap',
                    event
                  });
                } else {
                  console.log(`   ❌ Failed to parse AMM swap`);
                }
              }
            }
          } else if (data.ping) {
            // Handle ping/pong for keepalive
            const pingId = (data.ping as any).id;
            if (pingId) {
              await this.currentStream.write({ 
                pong: { id: pingId } 
              });
            }
          }
        } catch (error) {
          console.error('Error processing transaction:', error);
        }
      });

      this.currentStream.on('error', (error: Error) => {
        console.error('❌ Stream error:', error.message);
        this.handleError(error);
      });

      this.currentStream.on('end', () => {
        console.log('Stream ended');
        this.handleDisconnect();
      });

      // Send subscription request with callback
      this.currentStream.write(request, (err: any) => {
        if (err) {
          console.error('❌ Failed to write subscription request:', err);
          this.handleError(err);
        } else {
          console.log('✅ Subscription request sent successfully');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          if (this.callbacks.onConnect) {
            this.callbacks.onConnect();
          }
        }
      });
    } catch (error) {
      console.error('❌ Failed to subscribe:', error);
      this.handleError(error as Error);
    }
  }

  private getTransactionProgramId(transaction: any): string | null {
    try {
      const message = transaction.message;
      if (!message || !message.accountKeys || !message.instructions) return null;

      // Check each instruction for our target programs
      for (const ix of message.instructions) {
        const programIdIndex = ix.programIdIndex;
        if (programIdIndex < message.accountKeys.length) {
          const programKey = message.accountKeys[programIdIndex];
          // Convert to string if it's bytes
          const programId = typeof programKey === 'string' 
            ? programKey 
            : bs58.encode(programKey as unknown as Uint8Array);
          
          if (programId === PUMP_PROGRAM || programId === PUMP_SWAP_PROGRAM) {
            return programId;
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting program ID:', error);
      return null;
    }
  }

  private async handleError(error: Error): Promise<void> {
    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }

    // Only attempt reconnection for non-fatal errors
    if (error.message.includes('Stream removed') || 
        error.message.includes('RESOURCE_EXHAUSTED') ||
        error.message.includes('14 UNAVAILABLE')) {
      await this.reconnect();
    }
  }

  private handleDisconnect(): void {
    this.isConnected = false;
    if (this.callbacks.onDisconnect) {
      this.callbacks.onDisconnect();
    }
    this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('⚠️ Max reconnection attempts reached. Resetting to latest slot...');
      this.lastProcessedSlot = undefined;
      this.reconnectAttempts = 0;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    
    console.log(`🔄 Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    if (!this.isConnected) {
      await this.subscribe();
    }
  }

  async disconnect(): Promise<void> {
    console.log('🔌 Disconnecting dual-program subscription...');
    this.isConnected = false;
    if (this.currentStream) {
      try {
        this.currentStream.cancel();
        await new Promise(resolve => setTimeout(resolve, 100));
        this.currentStream.destroy();
      } catch (e) {
        console.error('Error disconnecting stream:', e);
      }
      this.currentStream = null;
    }
  }

  isActive(): boolean {
    return this.isConnected;
  }
}