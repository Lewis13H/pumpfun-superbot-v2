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
  private solPrice = 150; // Default, will be updated
  private progressMilestones = new Map<string, number>();

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

      // Subscription request following Shyft examples - transactions only for price data
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
      // Handle transaction data - this is where all the action happens
      if (data.transaction) {
        const formattedTx = this.formatTransaction(data);
        if (!formattedTx) return;

        // 1. Check for new token creation
        const newToken = this.detectNewToken(formattedTx);
        if (newToken) {
          console.log('🚀 New token detected:', newToken.address);
          this.emit('token:new', newToken);
        }

        // 2. Parse transaction for price updates and events
        const parsedData = this.parsePumpFunTransaction(formattedTx);
        if (parsedData) {
          // Log what type of transaction we found
          const instructionNames = parsedData.instructions.pumpFunIxs.map((ix: any) => ix.name).join(', ');
          if (instructionNames && instructionNames !== 'unknown') {
            console.log(`📊 Pump.fun transaction: ${instructionNames} (${formattedTx.signature.substring(0, 8)}...)`);
          }

          const priceUpdate = await this.extractPriceDataFromParsedTx(parsedData);
          if (priceUpdate) {
            this.priceBuffer.set(priceUpdate.token, priceUpdate);
            
            // Calculate and emit progress
            const progress = this.calculateBondingProgressFromReserves(
              Number(priceUpdate.virtualSolReserves) / 1e9
            );
            
            console.log(`💰 ${priceUpdate.token.substring(0, 8)}... - ${priceUpdate.priceUsd.toFixed(6)} | ${priceUpdate.liquidityUsd.toFixed(0)} liquidity | ${progress.toFixed(2)}% complete`);
            
            this.emitProgressMilestones(priceUpdate.token, progress, priceUpdate.bondingComplete);
          }
        }
      }
    } catch (error) {
      console.error('Error handling stream data:', error);
      this.emit('error', error);
    }
  }

  private parsePumpFunTransaction(tx: any): any | null {
    try {
      if (tx.meta?.err) return null;

      // Parse instructions manually
      const pumpFunIxs = [];
      const instructions = tx.message.instructions || [];
      
      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i];
        const programId = tx.message.accountKeys[ix.programIdIndex];
        
        if (programId === PUMP_PROGRAM) {
          try {
            // Decode instruction data
            const ixData = typeof ix.data === 'string' 
              ? utils.bytes.bs58.decode(ix.data)
              : Buffer.from(ix.data, 'base64');
            const discriminator = ixData.slice(0, 8);
            
            // Try to decode the instruction
            let parsedIx = {
              programId: PUMP_PROGRAM,
              name: 'unknown',
              data: {},
              accounts: []
            };

            // Check for known discriminators
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

            // Map accounts
            if (ix.accounts && ix.accounts.length > 0) {
              parsedIx.accounts = ix.accounts.map((accIndex: number, idx: number) => {
                const pubkey = tx.message.accountKeys[accIndex];
                // Map account names based on instruction type and position
                let name = `account${idx}`;
                if (parsedIx.name === 'create' && idx === 2) name = 'bonding_curve';
                if ((parsedIx.name === 'buy' || parsedIx.name === 'sell') && idx === 3) name = 'bonding_curve';
                
                return { pubkey, name };
              });
            }

            pumpFunIxs.push(parsedIx);
          } catch (e) {
            // Silent fail for individual instruction parsing
          }
        }
      }

      if (pumpFunIxs.length === 0) return null;

      // Parse events from logs - looking for "Program data:" entries
      let events = [];
      if (tx.meta?.logMessages) {
        for (const log of tx.meta.logMessages) {
          // Look for Program data from pump.fun program
          if (log.includes('Program data:')) {
            try {
              // Extract base64 data after "Program data:"
              const dataStart = log.indexOf('Program data:') + 'Program data:'.length;
              const eventDataBase64 = log.substring(dataStart).trim();
              
              // Only process if it's substantial data
              if (eventDataBase64.length > 50) {
                const eventData = Buffer.from(eventDataBase64, 'base64');
                
                console.log(`📦 Found program data: ${eventData.length} bytes`);
                
                // Parse the event data based on pump.fun event structure
                const parsedEventData = this.parseTradeEventData(eventData);
                if (parsedEventData) {
                  events.push({
                    name: 'TradeEvent',
                    data: parsedEventData
                  });
                }
              }
            } catch (e) {
              // Silent fail for event parsing
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

  private parseTradeEventData(eventData: Buffer): any {
    try {
      // Based on analyzing the logs, the event data structure seems to be:
      // - 8 bytes: event discriminator
      // - 32 bytes: mint address
      // - 8 bytes: sol amount
      // - 8 bytes: token amount
      // - 1 byte: is_buy flag
      // - 32 bytes: user pubkey
      // - 8 bytes: virtual token reserves
      // - 8 bytes: virtual sol reserves  
      // - 8 bytes: real token reserves
      // - 8 bytes: real sol reserves
      
      let offset = 0;
      
      // Skip discriminator (8 bytes)
      offset += 8;
      
      // Read mint (32 bytes)
      const mint = new PublicKey(eventData.slice(offset, offset + 32)).toBase58();
      offset += 32;
      
      // Read sol amount (8 bytes)
      const solAmount = eventData.readBigUInt64LE(offset);
      offset += 8;
      
      // Read token amount (8 bytes)
      const tokenAmount = eventData.readBigUInt64LE(offset);
      offset += 8;
      
      // Read is_buy flag (1 byte)
      const isBuy = eventData.readUInt8(offset) === 1;
      offset += 1;
      
      // Read user pubkey (32 bytes)
      const user = new PublicKey(eventData.slice(offset, offset + 32)).toBase58();
      offset += 32;
      
      // Read virtual token reserves (8 bytes)
      const virtualTokenReserves = eventData.readBigUInt64LE(offset);
      offset += 8;
      
      // Read virtual sol reserves (8 bytes)
      const virtualSolReserves = eventData.readBigUInt64LE(offset);
      offset += 8;
      
      // Read real token reserves (8 bytes)
      const realTokenReserves = eventData.readBigUInt64LE(offset);
      offset += 8;
      
      // Read real sol reserves (8 bytes)
      const realSolReserves = eventData.readBigUInt64LE(offset);
      offset += 8;

      // Log the raw values for debugging
      console.log(`📊 Raw event data - realSolReserves: ${realSolReserves}, virtualSolReserves: ${virtualSolReserves}`);

      return {
        mint,
        solAmount: Number(solAmount),
        tokenAmount: Number(tokenAmount),
        isBuy,
        user,
        virtual_token_reserves: Number(virtualTokenReserves),
        virtual_sol_reserves: Number(virtualSolReserves),
        real_token_reserves: Number(realTokenReserves),
        real_sol_reserves: Number(realSolReserves)
      };
    } catch (e) {
      console.error('Error parsing trade event data:', e);
      return null;
    }
  }

  private async extractPriceDataFromParsedTx(parsedData: any): Promise<PriceUpdate | null> {
    try {
      // Following the Shyft pattern from stream_pumpfun_token_price
      const parsedEvent = parsedData.instructions.events[0]?.data;
      
      // If no event data, check if this is a buy/sell transaction and extract from logs
      if (!parsedEvent) {
        // Look for buy/sell instruction
        const swapInstruction = parsedData.instructions.pumpFunIxs.find(
          (instruction: any) => instruction.name === 'buy' || instruction.name === 'sell'
        );
        
        if (!swapInstruction) {
          return null;
        }

        console.log(`⚠️ ${swapInstruction.name} transaction but no event data found`);
        return null;
      }

      const swapInstruction = parsedData.instructions.pumpFunIxs.find(
        (instruction: any) => instruction.name === 'buy' || instruction.name === 'sell'
      );
      
      // Also handle create instructions that might have initial price data
      const createInstruction = parsedData.instructions.pumpFunIxs.find(
        (i: any) => i.name === 'create'
      );
      
      if (!swapInstruction && !createInstruction) {
        return null;
      }

      // Extract data from event
      const virtualSolReserves = parsedEvent.virtual_sol_reserves || parsedEvent.virtualSolReserves;
      const virtualTokenReserves = parsedEvent.virtual_token_reserves || parsedEvent.virtualTokenReserves;
      const realSolReserves = parsedEvent.real_sol_reserves || parsedEvent.realSolReserves;
      const realTokenReserves = parsedEvent.real_token_reserves || parsedEvent.realTokenReserves;
      const mint = parsedEvent.mint;
      const complete = parsedEvent.complete || false;

      if (!virtualSolReserves || !virtualTokenReserves || !mint) {
        console.log('⚠️ Missing required event data for price calculation');
        return null;
      }

      // Calculate price using Shyft formula
      const priceSol = this.calculatePumpFunPrice(
        virtualSolReserves,
        virtualTokenReserves
      );

      if (priceSol <= 0) return null;

      const priceUsd = priceSol * this.solPrice;
      
      // FIXED: Properly convert real SOL reserves from lamports to SOL
      const liquiditySol = Number(realSolReserves) / 1e9;
      const liquidityUsd = liquiditySol * this.solPrice;
      
      // Token supply is typically 1 billion for pump.fun tokens
      const totalSupply = 1_000_000_000;
      const marketCapUsd = priceUsd * totalSupply;

      // Calculate progress
      const progress = this.calculateBondingProgressFromReserves(liquiditySol);

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

  private calculatePumpFunPrice(
    virtualSolReserves: number,
    virtualTokenReserves: number
  ): number {
    const sol = virtualSolReserves / 1_000_000_000; // convert lamports to SOL
    const tokens = virtualTokenReserves / Math.pow(10, 6);
    return sol / tokens;
  }

  private calculateBondingProgressFromReserves(realSolReserves: number): number {
    // Pump.fun graduation target is approximately 85 SOL
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
          accountKeys, // These are already strings
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
      // Following Shyft example - check postTokenBalances for new mints
      if (tx.meta?.postTokenBalances?.length > 0 && 
          (!tx.meta?.preTokenBalances || tx.meta.preTokenBalances.length === 0)) {
        
        // This is likely a new token creation
        const mint = tx.meta.postTokenBalances[0].mint;
        
        // Skip native SOL token
        if (mint === 'So11111111111111111111111111111111111111112') {
          return null;
        }
        
        // Also check if we have a create instruction
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
              creator: tx.message.accountKeys[0], // Already a string
              signature: tx.signature,
              timestamp: new Date()
            };
          }
        }

        // Even without parsed instruction, if we have a new mint in postTokenBalances
        // from pump.fun program, it's a new token (but skip if no pump.fun involvement)
        const hasPumpFunProgram = tx.message.accountKeys.includes(PUMP_PROGRAM);
        if (hasPumpFunProgram) {
          return {
            address: mint,
            bondingCurve: 'unknown',
            creator: tx.message.accountKeys[0], // Already a string
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

  private emitProgressMilestones(tokenMint: string, currentProgress: number, isComplete: boolean) {
    const lastMilestone = this.progressMilestones.get(tokenMint) || 0;
    
    // Define milestone thresholds
    const milestones = [10, 25, 50, 75, 90, 95, 99];
    
    // Check for milestone crossing
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

    // Check for graduation
    if (!this.progressMilestones.has(tokenMint + '_graduated') && isComplete) {
      console.log(`🎓 GRADUATED: ${tokenMint.substring(0, 8)}... has completed bonding curve!`);
      this.emit('graduated', {
        token: tokenMint,
        timestamp: new Date()
      });
      this.progressMilestones.set(tokenMint + '_graduated', 100);
    }

    // Update milestone tracking
    this.progressMilestones.set(tokenMint, currentProgress);
  }

  private async flushPriceBuffer() {
    if (this.priceBuffer.size === 0) return;

    const updates = Array.from(this.priceBuffer.values());
    this.priceBuffer.clear();

    console.log(`💾 Flushing ${updates.length} price updates to database`);

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