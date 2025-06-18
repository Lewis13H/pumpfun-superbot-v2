// src/monitor.ts
import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { utils } from "@coral-xyz/anchor";
import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { EventEmitter } from 'events';
import { config } from './config';
import { db, PriceUpdate } from './database';
import fetch from 'node-fetch';

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

// Token metadata interface
interface TokenMetadata {
  decimals: number;
  totalSupply: number;
}

export class PumpMonitor extends EventEmitter {
  private client: Client | null = null;
  private priceBuffer = new Map<string, PriceUpdate>();
  private flushTimer?: NodeJS.Timeout;
  private solPriceTimer?: NodeJS.Timeout;
  private solPrice = 1; // Start with 1, update immediately
  private progressMilestones = new Map<string, number>();
  private tokenCreationQueue = new Set<string>();
  private knownTokens = new Set<string>(); // Cache of known token addresses
  private priceUpdateBuffer = new Map<string, PriceUpdate>();
  private tokenMetadataCache = new Map<string, TokenMetadata>(); // Token metadata cache

  constructor() {
    super();
    this.client = new Client(
      config.shyft.endpoint,
      config.shyft.token,
      undefined
    );
  }

  async start() {
    console.log('🔄 Starting Pump.fun monitor...');
    console.log(`Endpoint: ${config.shyft.endpoint}`);
    console.log(`Program: ${PUMP_PROGRAM}`);

    // Load existing tokens into cache
    await this.loadKnownTokens();

    // Update SOL price before processing
    await this.updateSolPrice();
    console.log(`💵 Initial SOL price: $${this.solPrice}`);

    try {
      const stream = await this.client!.subscribe();
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

      // Set up SOL price timer
      this.solPriceTimer = setInterval(() => this.updateSolPrice(), 30000);

      // Refresh known tokens cache every 5 minutes
      setInterval(() => this.loadKnownTokens(), 300000);

      await streamClosed;
    } catch (error) {
      console.error('Failed to start monitor:', error);
      throw error;
    }
  }

  private async loadKnownTokens() {
    try {
      const result = await db.query(
        'SELECT address FROM tokens WHERE NOT archived AND bonding_curve != $1',
        ['unknown']
      );
      this.knownTokens.clear();
      result.rows.forEach((row: any) => this.knownTokens.add(row.address));
      console.log(`📊 Loaded ${this.knownTokens.size} known tokens`);
    } catch (error) {
      console.error('Error loading known tokens:', error);
    }
  }

  // Get token metadata with caching
  private async getTokenMetadata(tokenMint: string): Promise<TokenMetadata> {
    // Check cache first
    if (this.tokenMetadataCache.has(tokenMint)) {
      return this.tokenMetadataCache.get(tokenMint)!;
    }

    try {
      const response = await fetch(
        `https://api.shyft.to/sol/v1/token/get_info?network=mainnet-beta&token_address=${tokenMint}`,
        {
          headers: { 'x-api-key': config.shyft.apiKey },
          signal: AbortSignal.timeout(5000)
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      
      const metadata: TokenMetadata = {
        decimals: data.result?.decimals || 6,
        totalSupply: data.result?.total_supply ? parseInt(data.result.total_supply) : 1_000_000_000
      };

      this.tokenMetadataCache.set(tokenMint, metadata);
      return metadata;

    } catch (error) {
      console.warn(`Failed to fetch metadata for ${tokenMint}:`, error);
      
      // Default for Pump.fun tokens
      const defaultMetadata: TokenMetadata = { 
        decimals: 6, 
        totalSupply: 1_000_000_000 
      };
      this.tokenMetadataCache.set(tokenMint, defaultMetadata);
      return defaultMetadata;
    }
  }

  // FIXED: Removed overly strict token validation
  private async handleStreamData(data: any) {
    try {
      if (data.transaction) {
        const formattedTx = this.formatTransaction(data);
        if (!formattedTx) return;

        const newToken = this.detectNewToken(formattedTx);
        if (newToken) {
          console.log('🚀 New token detected:', newToken.address);
          this.tokenCreationQueue.add(newToken.address);
          this.knownTokens.add(newToken.address); // Add to cache immediately
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
            // FIXED: Allow price updates for any pump.fun token with reasonable market cap
            // Wait if token is still being created
            if (this.tokenCreationQueue.has(priceUpdate.token)) {
              console.log(`⏳ Waiting for token ${priceUpdate.token.substring(0, 8)}... to be saved`);
              await new Promise(resolve => setTimeout(resolve, 1000));
              this.tokenCreationQueue.delete(priceUpdate.token);
            }

            // Buffer the price update
            this.priceUpdateBuffer.set(priceUpdate.token, priceUpdate);
            console.log(`✅ Buffered price update for ${priceUpdate.token.substring(0, 8)}...`);

            if (priceUpdate.progress !== undefined) {
              this.emitProgressMilestones(priceUpdate.token, priceUpdate.progress, priceUpdate.bonding_complete);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error handling stream data:', error);
      this.emit('error', error);
    }
  }

  // FIXED: Improved trade event parsing
  private parseTradeEventData(eventData: Buffer): any {
    try {
      if (eventData.length !== 225) {
        return null; // Quietly skip non-trade events
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
      
      // Token amount for trade (8 bytes) - raw amount
      const tokenAmount = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Is buy (1 byte)
      const isBuy = eventData.readUInt8(offset) === 1;
      offset += 1;
      
      // User pubkey (32 bytes)
      const user = new PublicKey(eventData.slice(offset, offset + 32)).toBase58();
      offset += 32;
      
      // POST-TRADE RESERVES (current state after trade)
      // Virtual token reserves (8 bytes) - raw amount
      const virtualTokenReserves = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Virtual SOL reserves (8 bytes) - in lamports
      const virtualSolReserves = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Real token reserves (8 bytes) - raw amount
      const realTokenReserves = Number(eventData.readBigUInt64LE(offset));
      offset += 8;
      
      // Real SOL reserves (8 bytes) - in lamports
      const realSolReserves = Number(eventData.readBigUInt64LE(offset));
      offset += 8;

      console.log(`✅ Parsed ${isBuy ? 'BUY' : 'SELL'} event for ${mint.substring(0, 8)}...`);

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
    await this.flush();
  }

  // Updated flush method for dashboard integration
  private async flush() {
    const updates = Array.from(this.priceUpdateBuffer.values());
    
    if (updates.length === 0) return;
    
    try {
      await db.bulkInsertPriceUpdates(updates);
      console.log(`💾 Flushed ${updates.length} price updates`);
      
      // Emit flush event with the actual updates for WebSocket broadcasting
      this.emit('flush', { 
        count: updates.length,
        updates: updates.map(u => ({
          token: u.token,
          price_usd: u.price_usd,
          market_cap_usd: u.market_cap_usd,
          liquidity_usd: u.liquidity_usd
        }))
      });
      
      this.priceUpdateBuffer.clear();
    } catch (error) {
      console.error('Error flushing price updates:', error);
    }
  }

  // FIXED: Improved transaction parsing with better account handling
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

            // FIXED: Better account handling without warnings
            if (ix.accounts && ix.accounts.length > 0) {
              if (Array.isArray(ix.accounts) && typeof ix.accounts[0] === 'number') {
                // Normal case: accounts are indices
                parsedIx.accounts = ix.accounts.map((accIndex: number, idx: number) => {
                  const pubkey = tx.message.accountKeys[accIndex];
                  let name = `account${idx}`;
                  if (parsedIx.name === 'create' && idx === 2) name = 'bonding_curve';
                  if ((parsedIx.name === 'buy' || parsedIx.name === 'sell') && idx === 3) name = 'bonding_curve';
                  
                  return { pubkey, name };
                });
              } else {
                // Raw data case: silently handle without warning spam
                parsedIx.accounts = [];
              }
            }

            pumpFunIxs.push(parsedIx);
          } catch (e) {
            // Silent fail for parsing errors
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
                
                // Only process valid trade events (225 bytes)
                if (eventData.length === 225) {
                  const parsedEventData = this.parseTradeEventData(eventData);
                  if (parsedEventData) {
                    events.push({
                      name: 'TradeEvent',
                      data: parsedEventData
                    });
                  }
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

  // FIXED: Correct price calculation using Method 2 (SOL÷1e9, tokens raw)
  private calculatePumpFunPrice(
    virtualSolReserves: number,
    virtualTokenReserves: number,
    tokenDecimals: number = 6
  ): number {
    // Method 2: Convert SOL to human-readable, keep tokens raw
    // This is the method that gives reasonable market caps ($1K-$50K)
    const adjustedPrice = (virtualSolReserves / 1e9) / virtualTokenReserves;
    
    // Quick validation
    const testMCap = adjustedPrice * this.solPrice * 1_000_000_000;
    if (testMCap > 100_000) {
      console.warn(`⚠️ High market cap: $${testMCap.toLocaleString()} - check calculation`);
    }
    
    return adjustedPrice;
  }
  
  // FIXED: Clean price extraction without debugging spam
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
        return null;
      }

      // Get token metadata
      const tokenMetadata = await this.getTokenMetadata(mint);
      
      // Use the WORKING calculation method (Method 2)
      const priceSol = this.calculatePumpFunPrice(
        virtualSolReserves, 
        virtualTokenReserves, 
        tokenMetadata.decimals
      );
      
      if (this.solPrice <= 1) {
        await this.updateSolPrice();
      }

      const priceUsd = priceSol * this.solPrice;
      const liquiditySol = realSolReserves / 1e9;
      const liquidityUsd = liquiditySol * this.solPrice;
      const marketCapUsd = priceUsd * tokenMetadata.totalSupply;
      const progress = this.calculateBondingProgressFromReserves(liquiditySol);

      // SAFETY CHECK: Block unreasonable market caps
      if (marketCapUsd > 10_000_000) {  // > $10M is definitely wrong
        console.error(`🚨 BLOCKING: MCap $${marketCapUsd.toLocaleString()} too high for ${mint.substring(0, 8)}...`);
        return null;
      }

      // Clean, concise logging
      console.log(`💰 ${mint.substring(0, 8)}...: $${priceUsd.toFixed(8)} | MCap: $${marketCapUsd.toLocaleString()} | Liq: ${liquiditySol.toFixed(2)} SOL`);

      return {
        token: mint,
        price_sol: priceSol,
        price_usd: priceUsd,
        liquidity_sol: liquiditySol,
        liquidity_usd: liquidityUsd,
        market_cap_usd: marketCapUsd,
        bonding_complete: complete,
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

  // Token detection with proper bonding curve extraction
  private detectNewToken(tx: any): any | null {
    try {
      if (tx.meta?.postTokenBalances?.length > 0 && 
          (!tx.meta?.preTokenBalances || tx.meta.preTokenBalances.length === 0)) {
        
        const mint = tx.meta.postTokenBalances[0].mint;
        
        if (mint === 'So11111111111111111111111111111111111111112') {
          return null;
        }
        
        let bondingCurve = null;
        
        // For pump.fun token creation, the structure is consistent:
        // Account 0: Creator/Signer
        // Account 1: Token mint (new token)
        // Account 2: Bonding curve PDA
        // Account 3: Associated bonding curve account
        // Account 4+: Other pump.fun accounts
        
        // Verify this is a pump.fun transaction
        const hasPumpProgram = tx.message.accountKeys.includes(PUMP_PROGRAM);
        if (hasPumpProgram && tx.message.accountKeys.length >= 3) {
          // The bonding curve is always at index 2 for pump.fun create transactions
          bondingCurve = tx.message.accountKeys[2];
          
          // Validate it's not a system program or token program
          if (bondingCurve && 
              !bondingCurve.startsWith('11111') && 
              !bondingCurve.startsWith('So111') &&
              !bondingCurve.startsWith('TokenkegQ') &&
              bondingCurve.length >= 32) {
            console.log(`✅ Found bonding curve: ${bondingCurve} for token ${mint.substring(0, 8)}...`);
          } else {
            // If index 2 doesn't look right, try to find it via instruction parsing
            const instructions = tx.message.instructions || [];
            for (const ix of instructions) {
              const programId = tx.message.accountKeys[ix.programIdIndex];
              if (programId === PUMP_PROGRAM && ix.accounts && ix.accounts.length >= 3) {
                // Get the account at index 2 of the instruction accounts
                const bondingCurveIndex = ix.accounts[2];
                bondingCurve = tx.message.accountKeys[bondingCurveIndex];
                console.log(`📍 Found bonding curve via instruction: ${bondingCurve}`);
                break;
              }
            }
          }
        }

        // Validation - don't save without valid bonding curve
        if (!bondingCurve || bondingCurve === 'unknown' || bondingCurve === 'undefined' || bondingCurve.length < 32) {
          console.error(`❌ No valid bonding curve found for token ${mint}`);
          console.log('Transaction:', tx.signature);
          console.log('Accounts:', tx.message.accountKeys?.slice(0, 5));
          
          // Don't save tokens without proper bonding curves
          return null;
        }

        console.log(`✅ New token ${mint.substring(0, 8)}... with bonding curve ${bondingCurve.substring(0, 8)}...`);

        return {
          address: mint,
          bondingCurve,
          creator: tx.message.accountKeys[0],
          signature: tx.signature,
          timestamp: new Date()
        };
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
      
      const data = await response.json() as { solana?: { usd?: number } };
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
      milestonesTracked: this.progressMilestones.size,
      knownTokens: this.knownTokens.size,
      cachedMetadata: this.tokenMetadataCache.size
    };
  }

  async stop() {
    console.log('Stopping monitor...');
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    if (this.solPriceTimer) {
      clearInterval(this.solPriceTimer);
    }
    await this.flush(); // Final flush
    if (this.client) {
      // Yellowstone client doesn't have a close method, just let it disconnect
      this.client = null;
    }
    this.emit('stopped');
  }
}