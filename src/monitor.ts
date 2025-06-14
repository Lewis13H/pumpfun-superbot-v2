import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { utils } from "@coral-xyz/anchor";
import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';  // Changed this line
import { EventEmitter } from 'events';
import { config } from './config';
import { db, PriceUpdate } from './database';

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// Helper function to decode base64 to base58
function decodeTransact(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) {
    return utils.bytes.bs58.encode(data);
  }
  return utils.bytes.bs58.encode(Buffer.from(data, 'base64'));
}

export class PumpMonitor extends EventEmitter {
  private client: Client;
  private priceBuffer = new Map<string, PriceUpdate>();
  private flushTimer?: NodeJS.Timeout;
  private solPrice = 150; // Default, will be updated

  constructor() {
    super();
    this.client = new Client(
      config.shyft.grpcEndpoint,
      config.shyft.grpcToken,
      undefined
    );
  }

  async start() {
    console.log('🔄 Starting Pump.fun monitor...');
    console.log(`Endpoint: ${config.shyft.grpcEndpoint}`);
    console.log(`Program: ${PUMP_PROGRAM}`);

    try {
      const stream = await this.client.subscribe();
      console.log('📡 Stream created successfully');

      const streamClosed = new Promise<void>((resolve, reject) => {
        stream.on("error", (error) => {
          console.log("❌ Stream error:", error);
          reject(error);
          stream.end();
        });
        stream.on("end", () => {
          console.log("Stream ended");
          resolve();
        });
        stream.on("close", () => {
          console.log("Stream closed");
          resolve();
        });
      });

      // Handle updates
      stream.on("data", async (data) => {
        await this.handleStreamData(data);
      });

      // Send subscription request
      const subscribeRequest = {
        accounts: {},
        slots: {},
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
        transactionsStatus: {},
        entry: {},
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
        ping: undefined,
        commitment: CommitmentLevel.PROCESSED,
      };

      console.log('📤 Sending subscription request...');
      await new Promise<void>((resolve, reject) => {
        stream.write(subscribeRequest, (err: any) => {
          if (err === null || err === undefined) {
            console.log('✅ Subscription request sent successfully');
            resolve();
          } else {
            console.log('❌ Failed to send subscription request:', err);
            reject(err);
          }
        });
      }).catch((reason) => {
        console.error(reason);
        throw reason;
      });

      console.log('✅ Monitor started and listening for pump.fun transactions');

      // Start flush timer
      this.flushTimer = setInterval(
        () => this.flushPriceBuffer(),
        config.monitoring.flushInterval
      );

      // Update SOL price periodically
      this.updateSolPrice();
      setInterval(() => this.updateSolPrice(), 60000); // Every minute

      await streamClosed;
    } catch (error) {
      console.error('Failed to start monitor:', error);
      throw error;
    }
  }

  private async handleStreamData(data: any) {
    try {
      if (data.transaction) {
        const formattedTx = this.formatTransaction(data);
        if (formattedTx) {
          const newToken = this.detectNewToken(formattedTx);
          if (newToken) {
            console.log('🚀 New token detected:', newToken.address);
            this.emit('token:new', newToken);
          }
        }
      }

      if (data.account) {
        const priceUpdate = this.parseBondingCurve(data.account);
        if (priceUpdate) {
          this.priceBuffer.set(priceUpdate.token, priceUpdate);
        }
      }
    } catch (error) {
      console.error('Error handling stream data:', error);
      this.emit('error', error);
    }
  }

  private formatTransaction(data: any): any {
    try {
      // Following the structure from the working example
      const dataTx = data.transaction?.transaction;
      if (!dataTx) return null;

      const signature = decodeTransact(dataTx.signature);
      const message = dataTx.transaction?.message;
      if (!message) return null;

      const header = message.header;
      const accountKeys = message.accountKeys?.map((key: any) => decodeTransact(key)) || [];
      const recentBlockhash = decodeTransact(message.recentBlockhash);
      const instructions = message.instructions || [];
      const meta = dataTx.meta;

      return {
        slot: data.slot || dataTx.slot,
        signature,
        message: {
          header,
          accountKeys,
          recentBlockhash,
          instructions
        },
        meta
      };
    } catch (error) {
      console.error('Error formatting transaction:', error);
      return null;
    }
  }

  private detectNewToken(tx: any): any | null {
    try {
      // Check for create discriminator (from pump.fun IDL)
      const CREATE_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
      
      // Look for create instruction
      for (const ix of tx.message.instructions || []) {
        const programIdIndex = ix.programIdIndex;
        const programId = tx.message.accountKeys[programIdIndex];
        
        if (programId !== PUMP_PROGRAM) continue;
        
        const data = ix.data ? Buffer.from(ix.data, 'base64') : null;
        if (!data || data.length < 8) continue;
        
        if (data.slice(0, 8).equals(CREATE_DISCRIMINATOR)) {
          // Check if this is actually a new token creation by looking at postTokenBalances
          if (tx.meta?.postTokenBalances?.length > 0) {
            const mint = tx.meta.postTokenBalances[0].mint;
            const accountIndex = ix.accounts[0];
            const bondingCurveIndex = ix.accounts[2];
            
            return {
              address: mint || tx.message.accountKeys[accountIndex],
              bondingCurve: tx.message.accountKeys[bondingCurveIndex],
              creator: tx.message.accountKeys[0], // First signer is usually the creator
              signature: tx.signature,
              timestamp: new Date()
            };
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error detecting new token:', error);
      return null;
    }
  }

  private parseBondingCurve(account: any): PriceUpdate | null {
    try {
      const data = Buffer.from(account.account.data, 'base64');
      const discriminator = data.readBigUInt64LE(0);
      
      // Bonding curve discriminator from IDL
      if (discriminator !== 0x17b7f837_60d8ac60n) return null;

      const tokenAddress = new PublicKey(data.slice(8, 40)).toBase58();
      const virtualTokenReserves = data.readBigUInt64LE(40);
      const virtualSolReserves = data.readBigUInt64LE(48);
      const realTokenReserves = data.readBigUInt64LE(56);
      const realSolReserves = data.readBigUInt64LE(64);
      const tokenTotalSupply = data.readBigUInt64LE(72);
      const complete = data.readUInt8(80) === 1;

      const priceSol = Number(virtualSolReserves) / Number(virtualTokenReserves);
      const liquiditySol = Number(realSolReserves) / 1e9;
      
      return {
        token: tokenAddress,
        priceSol,
        priceUsd: priceSol * this.solPrice,
        liquiditySol,
        liquidityUsd: liquiditySol * this.solPrice,
        marketCapUsd: priceSol * this.solPrice * 1_000_000_000,
        virtualSolReserves,
        virtualTokenReserves,
        bondingComplete: complete
      };
    } catch (error) {
      console.error('Error parsing bonding curve:', error);
      return null;
    }
  }

  private async flushPriceBuffer() {
    if (this.priceBuffer.size === 0) return;

    const updates = Array.from(this.priceBuffer.values());
    this.priceBuffer.clear();

    // Batch insert price updates
    for (const batch of this.chunk(updates, config.monitoring.batchSize)) {
      await Promise.all(
        batch.map(update => db.insertPriceUpdate(update))
      );
    }

    this.emit('flush', { count: updates.length });
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  private async updateSolPrice() {
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
      );
      const data = await response.json();
      this.solPrice = data.solana.usd;
      console.log(`💵 SOL Price updated: $${this.solPrice}`);
    } catch (error) {
      console.error('Failed to update SOL price:', error);
    }
  }

  async stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flushPriceBuffer();
    await this.client.close();
  }
}