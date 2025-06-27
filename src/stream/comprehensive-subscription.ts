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
import { parseAmmPoolAccount } from '../utils/amm-account-parser-simple';
import bs58 from 'bs58';

// Account data interfaces
export interface BondingCurveAccount {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  tokenMint: string;
  complete: boolean;
}

export interface AmmPoolAccount {
  baseReserves: bigint;
  quoteReserves: bigint;
  baseMint: string;
  quoteMint: string;
  poolAddress: string;
}

// Extended event types
export interface SimpleTradeEvent {
  mint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp: Date;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  price: number;
  symbol?: string;
  signature: string;
  slot: bigint;
}

export type ComprehensiveEvent = 
  | { type: 'bonding_curve_trade', event: SimpleTradeEvent }
  | { type: 'amm_swap', event: AmmSwapEvent }
  | { type: 'bonding_curve_account', account: BondingCurveAccount, slot: bigint }
  | { type: 'amm_pool_account', account: AmmPoolAccount, slot: bigint };

interface ComprehensiveCallbacks {
  onUpdate: (event: ComprehensiveEvent) => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export class ComprehensiveSubscription {
  private streamClient: StreamClient;
  private transactionStream: any = null;
  private accountStream: any = null;
  private callbacks: ComprehensiveCallbacks;
  private isConnected = false;
  private bondingCurveParser: SimpleTradeEventParser;
  private ammParser: AmmSwapParser;

  constructor(callbacks: ComprehensiveCallbacks) {
    this.callbacks = callbacks;
    this.streamClient = StreamClient.getInstance();
    this.bondingCurveParser = new SimpleTradeEventParser();
    this.ammParser = new AmmSwapParser();
  }

  async subscribe(): Promise<void> {
    try {
      console.log(`🔄 Starting comprehensive subscription...`);
      console.log(`📍 Programs: ${PUMP_PROGRAM} (Bonding) + ${PUMP_SWAP_PROGRAM} (AMM)`);
      console.log(`📊 Monitoring: Transactions + Account Updates`);

      const client = await this.streamClient.getClient();

      // Subscribe to transactions
      await this.subscribeToTransactions(client);
      
      // Subscribe to account updates
      await this.subscribeToAccounts(client);

      this.isConnected = true;
      if (this.callbacks.onConnect) {
        this.callbacks.onConnect();
      }
      console.log('✅ Comprehensive subscription connected successfully');
    } catch (error) {
      console.error('❌ Failed to subscribe:', error);
      if (this.callbacks.onError) {
        this.callbacks.onError(error as Error);
      }
    }
  }

  private async subscribeToTransactions(client: any): Promise<void> {
    // Transaction subscription request
    const txRequest: SubscribeRequest = {
      slots: {},
      accounts: {},
      transactions: {
        comprehensive_tx: {
          vote: false,
          failed: false,
          accountInclude: [PUMP_PROGRAM, PUMP_SWAP_PROGRAM],
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

    this.transactionStream = await client.subscribe();

    // Handle transaction data
    this.transactionStream.on('data', async (data: SubscribeUpdate) => {
      try {
        if (data.transaction) {
          await this.handleTransaction(data.transaction);
        } else if (data.ping) {
          const pingId = (data.ping as any).id;
          if (pingId) {
            await this.transactionStream.write({ pong: { id: pingId } });
          }
        }
      } catch (error) {
        console.error('Error processing transaction:', error);
      }
    });

    this.transactionStream.on('error', (error: Error) => {
      console.error('❌ Transaction stream error:', error.message);
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
    });

    // Send transaction subscription
    this.transactionStream.write(txRequest, (err: any) => {
      if (err) {
        console.error('❌ Failed to subscribe to transactions:', err);
      } else {
        console.log('✅ Transaction subscription active');
      }
    });
  }

  private async subscribeToAccounts(client: any): Promise<void> {
    // Account subscription request
    const accountRequest: SubscribeRequest = {
      slots: {},
      accounts: {
        comprehensive_accounts: {
          // Monitor all accounts owned by our programs
          account: [],
          owner: [PUMP_PROGRAM, PUMP_SWAP_PROGRAM],
          filters: [],
        },
      },
      transactions: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED,
      entry: {},
      transactionsStatus: {},
    };

    this.accountStream = await client.subscribe();

    // Handle account data
    this.accountStream.on('data', async (data: SubscribeUpdate) => {
      try {
        if (data.account) {
          await this.handleAccount(data.account);
        } else if (data.ping) {
          const pingId = (data.ping as any).id;
          if (pingId) {
            await this.accountStream.write({ pong: { id: pingId } });
          }
        }
      } catch (error) {
        console.error('Error processing account:', error);
      }
    });

    this.accountStream.on('error', (error: Error) => {
      console.error('❌ Account stream error:', error.message);
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
    });

    // Send account subscription
    this.accountStream.write(accountRequest, (err: any) => {
      if (err) {
        console.error('❌ Failed to subscribe to accounts:', err);
      } else {
        console.log('✅ Account subscription active');
      }
    });
  }

  private async handleTransaction(txUpdate: any): Promise<void> {
    const slot = txUpdate.slot ? BigInt(txUpdate.slot) : BigInt(0);
    
    if (txUpdate.transaction?.transaction) {
      const tx = txUpdate.transaction;
      const signature = bs58.encode(tx.signature || new Uint8Array());
      
      // Determine which program this transaction belongs to
      const programId = this.getTransactionProgramId(tx.transaction);
      
      if (programId === PUMP_PROGRAM) {
        // Parse bonding curve trade
        const logs = tx.meta?.logMessages || [];
        const events = this.bondingCurveParser.parseTradeEvents(logs);
        
        for (const event of events) {
          const priceData = calculatePrice(
            event.virtualSolReserves,
            event.virtualTokenReserves,
            180 // Default SOL price
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
            slot: slot,
          };
          
          this.callbacks.onUpdate({
            type: 'bonding_curve_trade',
            event: enrichedEvent
          });
        }
      } else if (programId === PUMP_SWAP_PROGRAM) {
        // Parse AMM swap
        const event = this.ammParser.parseTransaction(
          tx,
          signature,
          slot.toString(),
          Math.floor(Date.now() / 1000).toString()
        );
        
        if (event) {
          this.callbacks.onUpdate({
            type: 'amm_swap',
            event
          });
        }
      }
    }
  }

  private async handleAccount(accountUpdate: any): Promise<void> {
    try {
      const slot = accountUpdate.slot ? BigInt(accountUpdate.slot) : BigInt(0);
      const accountInfo = accountUpdate.account;
      
      if (!accountInfo) return;
      
      const owner = accountInfo.owner;
      const data = accountInfo.data;
      const pubkey = accountInfo.pubkey;
      
      if (!owner || !data) return;
      
      // Convert owner to string if needed
      const ownerStr = typeof owner === 'string' 
        ? owner 
        : bs58.encode(owner as unknown as Uint8Array);
      
      if (ownerStr === PUMP_PROGRAM) {
        // Parse bonding curve account
        const account = this.parseBondingCurveAccount(data, pubkey);
        if (account) {
          this.callbacks.onUpdate({
            type: 'bonding_curve_account',
            account,
            slot
          });
        }
      } else if (ownerStr === PUMP_SWAP_PROGRAM) {
        // Parse AMM pool account
        const account = this.parseAmmPoolAccount(data, pubkey);
        if (account) {
          this.callbacks.onUpdate({
            type: 'amm_pool_account',
            account,
            slot
          });
        }
      }
    } catch (error) {
      console.error('Error handling account update:', error);
    }
  }

  private parseBondingCurveAccount(data: any, _pubkey: any): BondingCurveAccount | null {
    try {
      // Bonding curve account structure (simplified)
      const dataBuffer = Buffer.from(data);
      
      if (dataBuffer.length < 138) return null; // Minimum size check
      
      let offset = 8; // Skip discriminator
      
      const virtualSolReserves = dataBuffer.readBigUInt64LE(offset);
      offset += 8;
      
      const virtualTokenReserves = dataBuffer.readBigUInt64LE(offset);
      offset += 8;
      
      const realSolReserves = dataBuffer.readBigUInt64LE(offset);
      offset += 8;
      
      const realTokenReserves = dataBuffer.readBigUInt64LE(offset);
      offset += 8;
      
      offset += 8; // Skip token total supply
      
      const complete = dataBuffer.readUInt8(offset) === 1;
      
      return {
        virtualSolReserves,
        virtualTokenReserves,
        realSolReserves,
        realTokenReserves,
        tokenMint: '', // Would need to extract from account data
        complete
      };
    } catch (error) {
      return null;
    }
  }

  private parseAmmPoolAccount(data: any, pubkey: any): AmmPoolAccount | null {
    try {
      // Use the simple AMM account parser
      const dataBuffer = Buffer.from(data);
      
      if (dataBuffer.length < 100) return null; // Minimum size check
      
      const parsed = parseAmmPoolAccount(dataBuffer, pubkey);
      
      if (!parsed) {
        return null;
      }
      
      return {
        baseReserves: parsed.baseReserve,
        quoteReserves: parsed.quoteReserve,
        baseMint: parsed.baseMint,
        quoteMint: parsed.quoteMint,
        poolAddress: parsed.poolAddress
      };
    } catch (error) {
      console.error('Error parsing AMM pool account:', error);
      return null;
    }
  }

  private getTransactionProgramId(transaction: any): string | null {
    try {
      const message = transaction.message;
      if (!message || !message.accountKeys || !message.instructions) return null;

      for (const ix of message.instructions) {
        const programIdIndex = ix.programIdIndex;
        if (programIdIndex < message.accountKeys.length) {
          const programKey = message.accountKeys[programIdIndex];
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

  async disconnect(): Promise<void> {
    console.log('🔌 Disconnecting comprehensive subscription...');
    this.isConnected = false;
    
    if (this.transactionStream) {
      try {
        this.transactionStream.cancel();
        await new Promise(resolve => setTimeout(resolve, 100));
        this.transactionStream.destroy();
      } catch (e) {
        console.error('Error disconnecting transaction stream:', e);
      }
    }
    
    if (this.accountStream) {
      try {
        this.accountStream.cancel();
        await new Promise(resolve => setTimeout(resolve, 100));
        this.accountStream.destroy();
      } catch (e) {
        console.error('Error disconnecting account stream:', e);
      }
    }
  }

  isActive(): boolean {
    return this.isConnected;
  }
}