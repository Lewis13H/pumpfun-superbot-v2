import { 
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate 
} from '@triton-one/yellowstone-grpc';
import { PUMP_PROGRAM } from '../utils/constants';
import { StreamClient } from './client';
import { 
  BONDING_CURVE_LAYOUT, 
  BondingCurveAccount, 
  BondingCurveData,
  BONDING_CURVE_TARGET_SOL,
  LAMPORTS_PER_SOL
} from '../types/bonding-curve';

export class AccountSubscriptionHandler {
  private streamClient: StreamClient;
  private currentStream: any = null;
  private isRunning = false;
  private bondingCurves: Map<string, BondingCurveData> = new Map();
  private onUpdateCallback?: (data: BondingCurveData) => void;
  
  constructor() {
    this.streamClient = StreamClient.getInstance();
  }
  
  async start(): Promise<void> {
    this.isRunning = true;
    await this.subscribe();
  }
  
  async stop(): Promise<void> {
    console.log('\n🛑 Stopping account subscription...');
    this.isRunning = false;
    
    if (this.currentStream) {
      try {
        this.currentStream.cancel();
        this.currentStream = null;
      } catch (error) {
        console.error('Error cancelling account stream:', error);
      }
    }
  }
  
  onUpdate(callback: (data: BondingCurveData) => void): void {
    this.onUpdateCallback = callback;
  }
  
  getBondingCurve(pubkey: string): BondingCurveData | undefined {
    return this.bondingCurves.get(pubkey);
  }
  
  private createAccountRequest(): SubscribeRequest {
    // Following the blog's example structure more closely
    const request: any = {
      slots: {},
      accounts: {
        raydium: {  // The blog uses "raydium" as the key name
          account: [],
          filters: [],
          owner: [PUMP_PROGRAM]
        }
      },
      transactions: {},
      blocks: {},
      blocksMeta: {
        block: []
      },
      accountsDataSlice: [],
      commitment: CommitmentLevel.PROCESSED,
      entry: {},
      transactionsStatus: {}
    };
    
    return request;
  }
  
  private async subscribe(): Promise<void> {
    const client = this.streamClient.getClient();
    const stream = await client.subscribe();
    this.currentStream = stream;
    
    return new Promise((_, reject) => {
      stream.on("data", (data: SubscribeUpdate) => {
        // Handle ping/pong at stream level
        if (data.ping) {
          stream.write({
            pong: { id: (data.ping as any).id }
          } as any);
          return;
        }
        this.handleAccountData(data);
      });
      
      stream.on("error", (error: any) => {
        if (error.code === 1) {
          console.log('✅ Account stream cancelled successfully');
        } else if (error.code !== 13) {
          console.error("Account stream error:", error);
        }
      });
      
      stream.on("end", () => {
        console.log("Account stream ended");
        this.currentStream = null;
        if (this.isRunning) {
          // Reconnect after a delay
          setTimeout(() => this.subscribe(), 1000);
        }
      });
      
      // Send subscription request
      const request = this.createAccountRequest();
      stream.write(request, (err: any) => {
        if (err) {
          reject(err);
        } else {
          console.log('✅ Account subscription started successfully');
        }
      });
    });
  }
  
  private handleAccountData(data: SubscribeUpdate): void {
    // Only process account updates
    if (!data.account || !data.account.account) {
      return;
    }
    
    try {
      const account = data.account.account;
      if (!account || !account.data) {
        return;
      }
      
      const pubkeyBuf = Buffer.isBuffer(account.pubkey) 
        ? account.pubkey 
        : Buffer.from(account.pubkey);
      console.log(`Received account update: ${pubkeyBuf.toString('base58' as any)} (${account.data.length} bytes)`);
      
      // Decode the account data
      const dataBuffer = Buffer.isBuffer(account.data) 
        ? account.data 
        : Buffer.from(account.data);
      const decoded = this.decodeBondingCurve(dataBuffer);
      if (!decoded) {
        console.log('Failed to decode as bonding curve');
        return;
      }
      
      // Calculate progress (0-85 SOL = 0-100%)
      const realSolInSol = Number(decoded.realSolReserves) / LAMPORTS_PER_SOL;
      const progress = Math.min((realSolInSol / BONDING_CURVE_TARGET_SOL) * 100, 100);
      
      // Calculate virtual price
      const virtualSolInSol = Number(decoded.virtualSolReserves) / LAMPORTS_PER_SOL;
      const virtualTokens = Number(decoded.virtualTokenReserves) / 1e6; // 6 decimals
      const virtualPriceInSol = virtualTokens > 0 ? virtualSolInSol / virtualTokens : 0;
      
      const bondingCurveData: BondingCurveData = {
        ...decoded,
        pubkey: pubkeyBuf.toString('base58' as any),
        progress,
        realSolInSol,
        virtualPriceInSol
      };
      
      // Store in map
      this.bondingCurves.set(bondingCurveData.pubkey, bondingCurveData);
      
      // Notify callback
      if (this.onUpdateCallback) {
        this.onUpdateCallback(bondingCurveData);
      }
      
      // Log update
      this.logBondingCurveUpdate(bondingCurveData);
      
    } catch (error) {
      // Silently skip decoding errors (might be other account types)
    }
  }
  
  private decodeBondingCurve(data: Buffer): BondingCurveAccount | null {
    try {
      // Check if data is large enough
      if (data.length < 73) return null; // 8 + 8*6 + 1 = 73 bytes minimum
      
      // Decode using borsh layout
      const decoded = BONDING_CURVE_LAYOUT.decode(data);
      
      return {
        discriminator: BigInt(decoded.discriminator),
        virtualTokenReserves: BigInt(decoded.virtualTokenReserves),
        virtualSolReserves: BigInt(decoded.virtualSolReserves),
        realTokenReserves: BigInt(decoded.realTokenReserves),
        realSolReserves: BigInt(decoded.realSolReserves),
        tokenTotalSupply: BigInt(decoded.tokenTotalSupply),
        complete: decoded.complete
      };
    } catch (error) {
      return null;
    }
  }
  
  private logBondingCurveUpdate(data: BondingCurveData): void {
    const status = data.complete ? '✅ COMPLETED' : '🔄 ACTIVE';
    const progressBar = this.createProgressBar(data.progress);
    
    console.log(`
📊 Bonding Curve Update:
   Address: ${data.pubkey}
   Progress: ${progressBar} ${data.progress.toFixed(1)}%
   Real SOL: ${data.realSolInSol.toFixed(4)} SOL
   Status: ${status}
   ${data.complete ? '   🎉 Migrated to Raydium!' : ''}
    `);
  }
  
  private createProgressBar(progress: number): string {
    const filled = Math.floor(progress / 5);
    const empty = 20 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}