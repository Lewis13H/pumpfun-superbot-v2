// src/monitor.ts - FINAL COMPLETE VERSION WITH CORRECT CALCULATIONS
import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { utils } from "@coral-xyz/anchor";
import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
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

// BN layout formatter from Shyft examples
function bnLayoutFormatter(obj: any) {
  if (!obj || typeof obj !== 'object') return;
  
  for (const key in obj) {
    if (obj[key] === null || obj[key] === undefined) continue;
    
    if (obj[key]?.constructor?.name === "PublicKey") {
      obj[key] = (obj[key] as PublicKey).toBase58();
    } else if (obj[key]?.constructor?.name === "BN") {
      obj[key] = Number(obj[key].toString());
    } else if (obj[key]?.constructor?.name === "BigInt") {
      obj[key] = Number(obj[key].toString());
    } else if (obj[key]?.constructor?.name === "Buffer") {
      obj[key] = (obj[key] as Buffer).toString("base64");
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      bnLayoutFormatter(obj[key]);
    }
  }
}

export class PumpMonitor extends EventEmitter {
  private client: Client;
  private priceBuffer = new Map<string, PriceUpdate>();
  private flushTimer?: NodeJS.Timeout;
  private solPrice = 1; // Start with 1, update immediately
  private progressMilestones = new Map<string, number>();
  private tokenCreationQueue = new Set<string>();

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

    // Update SOL price before processing
    await this.updateSolPrice();
    console.log(`💵 Initial SOL price: $${this.solPrice}`);

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

      stream.on("data", async (data) => {
        await this.handleStreamData(data);
      });

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
        commitment: CommitmentLevel.CONFIRMED,
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

      console.log('✅ Monitor started');

      this.flushTimer = setInterval(
        () => this.flushPriceBuffer(),
        config.monitoring.flushInterval
      );

      setInterval(() => this.updateSolPrice(), 30000);

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
        if (!formattedTx) return;

        const newToken = this.detectNewToken(formattedTx);
        if (newToken) {
          console.log('🚀 New token detected:', newToken.address);
          this.tokenCreationQueue.add(newToken.address);
          this.emit('token:new', newToken);
        }

        const parsedData = this.parsePumpFunTransaction(formattedTx);
        if (parsedData) {
          const instructionNames = parsedData.instructions.pumpFunIxs.map((ix: any) => ix.name).join(', ');
          if (instructionNames && instructionNames !== 'unknown') {
            console.log(`📊 Pump.fun transaction: ${instructionNames} (${formattedTx.signature.substring(0, 8)}...)`);
          }

          const priceUpdate = await this.extractPriceDataFromParsedTx(parsedData);
          if (priceUpdate) {
            if (this.tokenCreationQueue.has(priceUpdate.token)) {
              console.log(`⏳ Waiting for token ${priceUpdate.token.substring(0, 8)}... to be saved`);
              await new Promise(resolve => setTimeout(resolve, 1000));
              this.tokenCreationQueue.delete(priceUpdate.token);
            }

            this.priceBuffer.set(priceUpdate.token, priceUpdate);
            this.emitProgressMilestones(priceUpdate.token, priceUpdate.progress, priceUpdate.bondingComplete);
          }
        }
      }
    } catch (error) {
      console.error('Error handling stream data:', error);
      this.emit('error', error);
    }
  }

  // Parse trade event with correct pump.fun structure
  private parseTradeEventData(eventData: Buffer): any {
    try {
      console.log(`🔍 Parsing event data: ${eventData.length} bytes`);
      
      if (eventData.length !== 225) {
        console.log(`⚠️ Unexpected event size: ${eventData.length} bytes`);
        return null;
      }

      let offset = 0;
      
      // Skip event discriminator (8 bytes)
      offset += 8;
      
      // Mint address (32 bytes)
      const mint = new PublicKey(eventData.slice(offset, offset + 32)).toBase58();
      offset += 32;
      
      // SOL amount for trade (8 bytes) - in lamports
      const solAmount = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Token amount for trade (8 bytes) - with 6 decimals
      const tokenAmount = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Is buy (1 byte)
      const isBuy = eventData.readUInt8(offset) === 1;
      offset += 1;
      
      // User pubkey (32 bytes)
      const user = new PublicKey(eventData.slice(offset, offset + 32)).toBase58();
      offset += 32;
      
      // POST-TRADE RESERVES - these are the current state after the trade
      // Virtual token reserves (8 bytes)
      const virtualTokenReserves = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Virtual SOL reserves (8 bytes)
      const virtualSolReserves = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Real token reserves (8 bytes)
      const realTokenReserves = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Real SOL reserves (8 bytes)
      const realSolReserves = Number(eventData.readBigUInt64LE(offset));
      offset += 8;

      console.log(`✅ Parsed ${isBuy ? 'BUY' : 'SELL'} event for ${mint.substring(0, 8)}...`);
      console.log(`   Trade: ${solAmount / 1e9} SOL for ${tokenAmount / 1e6} tokens`);
      console.log(`   Virtual: ${virtualSolReserves} lamports / ${virtualTokenReserves} tokens`);
      console.log(`   Real: ${realSolReserves} lamports / ${realTokenReserves} tokens`);

      return {
        mint,
        solAmount,
        tokenAmount,
        isBuy,
        user,
        virtual_token_reserves: virtualTokenReserves,
        virtual_sol_reserves: virtualSolReserves,
        real_token_reserves: realTokenReserves,
        real_sol_reserves: realSolReserves
      };
    } catch (e) {
      console.error('Error parsing trade event:', e);
      return null;
    }
  }

  private emitProgressMilestones(tokenMint: string, currentProgress: number, isComplete: boolean) {
    const lastMilestone = this.progressMilestones.get(tokenMint) || 0;
    
    const milestones = [10, 25, 50, 75, 90, 95, 99];
    
    for (const milestone of milestones) {
      if (lastMilestone < milestone && currentProgress >= milestone) {
        console.log(`🎯 MILESTONE: ${tokenMint.substring(0, 8)}... reached ${milestone}% completion`);
        this.emit('milestone', {
          token: tokenMint,
          milestone,
          progress: currentProgress,
          timestamp: new Date()
        });
      }
    }

    if (!this.progressMilestones.has(tokenMint + '_graduated') && isComplete) {
      console.log(`🎓 GRADUATED: ${tokenMint.substring(0, 8)}... has completed bonding curve!`);
      this.emit('graduated', {
        token: tokenMint,
        timestamp: new Date()
      });
      this.progressMilestones.set(tokenMint + '_graduated', 100);
    }

    this.progressMilestones.set(tokenMint, currentProgress);
  }

  private async flushPriceBuffer() {
    if (this.priceBuffer.size === 0) return;

    const updates = Array.from(this.priceBuffer.values());
    this.priceBuffer.clear();

    console.log(`💾 Flushing ${updates.length} price updates to database`);

    try {
      for (const batch of this.chunk(updates, config.monitoring.batchSize)) {
        await Promise.all(
          batch.map(update => db.insertPriceUpdate(update))
        );
      }

      this.emit('flush', { count: updates.length });
    } catch (error) {
      console.error('Error flushing price buffer:', error);
      updates.forEach(update => this.priceBuffer.set(update.token, update));
    }
  }

  private parsePumpFunTransaction(tx: any): any | null {
    try {
      if (tx.meta?.err) return null;

      const pumpFunIxs = [];
      const instructions = tx.message.instructions || [];
      
      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i];
        const programId = tx.message.accountKeys[ix.programIdIndex];
        
        if (programId === PUMP_PROGRAM) {
          try {
            const ixData = typeof ix.data === 'string' 
              ? utils.bytes.bs58.decode(ix.data)
              : Buffer.from(ix.data, 'base64');
            const discriminator = ixData.slice(0, 8);
            
            let parsedIx = {
              programId: PUMP_PROGRAM,
              name: 'unknown',
              data: {},
              accounts: []
            };

            const CREATE_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
            const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
            const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

            if (Buffer.from(discriminator).equals(CREATE_DISCRIMINATOR)) {
              parsedIx.name = 'create';
            } else if (Buffer.from(discriminator).equals(BUY_DISCRIMINATOR)) {
              parsedIx.name = 'buy';
            } else if (Buffer.from(discriminator).equals(SELL_DISCRIMINATOR)) {
              parsedIx.name = 'sell';
            }

            if (ix.accounts && ix.accounts.length > 0) {
              parsedIx.accounts = ix.accounts.map((accIndex: number, idx: number) => {
                const pubkey = tx.message.accountKeys[accIndex];
                let name = `account${idx}`;
                if (parsedIx.name === 'create' && idx === 2) name = 'bonding_curve';
                if ((parsedIx.name === 'buy' || parsedIx.name === 'sell') && idx === 3) name = 'bonding_curve';
                
                return { pubkey, name };
              });
            }

            pumpFunIxs.push(parsedIx);
          } catch (e) {
            // Silent fail
          }
        }
      }

      if (pumpFunIxs.length === 0) return null;

      let events = [];
      if (tx.meta?.logMessages) {
        for (const log of tx.meta.logMessages) {
          if (log.includes('Program data:')) {
            try {
              const dataStart = log.indexOf('Program data:') + 'Program data:'.length;
              const eventDataBase64 = log.substring(dataStart).trim();
              
              if (eventDataBase64.length > 50) {
                const eventData = Buffer.from(eventDataBase64, 'base64');
                
                console.log(`📦 Found program data: ${eventData.length} bytes`);
                
                const parsedEventData = this.parseTradeEventData(eventData);
                if (parsedEventData) {
                  events.push({
                    name: 'TradeEvent',
                    data: parsedEventData
                  });
                }
              }
            } catch (e) {
              // Silent fail
            }
          }
        }
      }

      const result = { 
        instructions: { pumpFunIxs, events }, 
        transaction: tx 
      };
      
      bnLayoutFormatter(result);
      return result;
    } catch (error) {
      console.error('Error parsing pump.fun transaction:', error);
      return null;
    }
  }

  // CRITICAL FIX: Correct price calculation - DO NOT DIVIDE TOKEN RESERVES!
  private calculatePumpFunPrice(
    virtualSolReserves: number,
    virtualTokenReserves: number
  ): number {
    // Convert lamports to SOL
    const sol = virtualSolReserves / 1_000_000_000;
    
    // CRITICAL: The token reserves are already the actual token count!
    // Do NOT divide by 1e6 or any other number
    const tokens = virtualTokenReserves;
    
    // Price per token in SOL
    const price = sol / tokens;
    
    console.log(`💵 Price calc: ${sol.toFixed(6)} SOL / ${tokens.toLocaleString()} tokens = ${price.toFixed(9)} SOL/token`);
    
    return price;
  }

  // Extract price with correct calculations
  private async extractPriceDataFromParsedTx(parsedData: any): Promise<PriceUpdate | null> {
    try {
      const parsedEvent = parsedData.instructions.events[0]?.data;
      
      if (!parsedEvent) {
        return null;
      }

      const mint = parsedEvent.mint;
      const virtualSolReserves = parsedEvent.virtual_sol_reserves;
      const virtualTokenReserves = parsedEvent.virtual_token_reserves;
      const realSolReserves = parsedEvent.real_sol_reserves || 0;
      const complete = parsedEvent.complete || false;

      if (!virtualSolReserves || !virtualTokenReserves || !mint) {
        console.log('⚠️ Missing required event data');
        return null;
      }

      // Calculate price with FIXED formula
      const priceSol = this.calculatePumpFunPrice(virtualSolReserves, virtualTokenReserves);
      
      // Ensure we have current SOL price
      if (this.solPrice <= 1) {
        await this.updateSolPrice();
      }

      const priceUsd = priceSol * this.solPrice;
      const liquiditySol = realSolReserves / 1e9;
      const liquidityUsd = liquiditySol * this.solPrice;
      
      // Market cap for 1 billion tokens
      const totalSupply = 1_000_000_000;
      const marketCapUsd = priceUsd * totalSupply;

      // Calculate progress
      const progress = this.calculateBondingProgressFromReserves(liquiditySol);

      // Final validation
      if (priceUsd > 1) {
        console.error(`❌ Price still too high: $${priceUsd}`);
        console.error(`   Calculation: ${virtualSolReserves / 1e9} SOL / ${virtualTokenReserves} tokens`);
        console.error(`   = ${priceSol} SOL = $${priceUsd}`);
        // Still save it to see what's happening
      }

      console.log(`💰 ${mint.substring(0, 8)}...`);
      console.log(`   Price: ${priceSol.toFixed(9)} SOL = $${priceUsd.toFixed(6)}`);
      console.log(`   MCap: $${marketCapUsd.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
      console.log(`   Liquidity: ${liquiditySol.toFixed(2)} SOL | Progress: ${progress.toFixed(1)}%`);

      return {
        token: mint,
        priceSol,
        priceUsd,
        liquiditySol,
        liquidityUsd,
        marketCapUsd,
        virtualSolReserves,
        virtualTokenReserves,
        bondingComplete: complete,
        progress
      };

    } catch (error) {
      console.error('Error extracting price data:', error);
      return null;
    }
  }

  private calculateBondingProgressFromReserves(realSolReserves: number): number {
    const GRADUATION_TARGET_SOL = 85;
    const progress = (realSolReserves / GRADUATION_TARGET_SOL) * 100;
    return Math.min(progress, 99.99);
  }

  private formatTransaction(data: any): any {
    try {
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
        meta,
        version: message.versioned ? 0 : 'legacy'
      };
    } catch (error) {
      console.error('Error formatting transaction:', error);
      return null;
    }
  }

  private detectNewToken(tx: any): any | null {
    try {
      if (tx.meta?.postTokenBalances?.length > 0 && 
          (!tx.meta?.preTokenBalances || tx.meta.preTokenBalances.length === 0)) {
        
        const mint = tx.meta.postTokenBalances[0].mint;
        
        if (mint === 'So11111111111111111111111111111111111111112') {
          return null;
        }
        
        const parsedData = this.parsePumpFunTransaction(tx);
        if (parsedData) {
          const createInstruction = parsedData.instructions.pumpFunIxs.find(
            (ix: any) => ix.name === 'create'
          );

          if (createInstruction && Array.isArray(createInstruction.accounts)) {
            const bondingCurve = createInstruction.accounts.find(
              (acc: any) => acc.name === 'bonding_curve'
            )?.pubkey;

            return {
              address: mint,
              bondingCurve: bondingCurve || 'unknown',
              creator: tx.message.accountKeys[0],
              signature: tx.signature,
              timestamp: new Date()
            };
          }
        }

        const hasPumpFunProgram = tx.message.accountKeys.includes(PUMP_PROGRAM);
        if (hasPumpFunProgram) {
          return {
            address: mint,
            bondingCurve: 'unknown',
            creator: tx.message.accountKeys[0],
            signature: tx.signature,
            timestamp: new Date()
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error detecting new token:', error);
      return null;
    }
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
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
        { 
          signal: AbortSignal.timeout(5000)
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const newPrice = data.solana?.usd;
      
      if (newPrice && newPrice > 0) {
        const oldPrice = this.solPrice;
        this.solPrice = newPrice;
        
        if (Math.abs(oldPrice - newPrice) > 5) {
          console.log(`💵 SOL Price changed: $${oldPrice} → $${newPrice}`);
        }
      } else {
        throw new Error('Invalid price data');
      }
    } catch (error) {
      console.error('Failed to update SOL price:', error);
      if (this.solPrice <= 1) {
        this.solPrice = 150;
        console.log(`💵 Using fallback SOL price: $${this.solPrice}`);
      }
    }
  }

  getStats() {
    return {
      priceBufferSize: this.priceBuffer.size,
      currentSolPrice: this.solPrice,
      milestonesTracked: this.progressMilestones.size
    };
  }

  async stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flushPriceBuffer();
    await this.client.close();
  }
}