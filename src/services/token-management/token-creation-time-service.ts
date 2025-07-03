/**
 * Token Creation Time Service
 * Fetches the actual blockchain creation timestamp for tokens
 */

import axios from 'axios';
import chalk from 'chalk';
import { Connection, PublicKey } from '@solana/web3.js';
import { db } from '../../database';

interface TokenCreationInfo {
  mintAddress: string;
  creationTime: Date;
  creationSlot: number;
  creator?: string;
  source: 'rpc' | 'shyft' | 'helius' | 'none';
}

export class TokenCreationTimeService {
  private static instance: TokenCreationTimeService;
  private connection: Connection;
  private shyftApiKey: string;
  private heliusApiKey: string;
  private cache = new Map<string, TokenCreationInfo>();
  // private readonly CACHE_TTL = 86400000; // 24 hours - unused for now
  
  private constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.shyftApiKey = process.env.SHYFT_API_KEY || process.env.SHYFT_GRPC_TOKEN || '';
    this.heliusApiKey = process.env.HELIUS_API_KEY || '';
  }
  
  static getInstance(): TokenCreationTimeService {
    if (!this.instance) {
      this.instance = new TokenCreationTimeService();
    }
    return this.instance;
  }
  
  /**
   * Get token creation time using multiple methods
   */
  async getTokenCreationTime(mintAddress: string): Promise<TokenCreationInfo | null> {
    try {
      // Check cache first
      const cached = this.cache.get(mintAddress);
      if (cached) {
        return cached;
      }
      
      // Try Shyft transaction history first (most reliable)
      const shyftResult = await this.getCreationTimeFromShyft(mintAddress);
      if (shyftResult) {
        this.cache.set(mintAddress, shyftResult);
        return shyftResult;
      }
      
      // Try Helius if available
      if (this.heliusApiKey) {
        const heliusResult = await this.getCreationTimeFromHelius(mintAddress);
        if (heliusResult) {
          this.cache.set(mintAddress, heliusResult);
          return heliusResult;
        }
      }
      
      // Fallback to RPC signatures (slower)
      const rpcResult = await this.getCreationTimeFromRPC(mintAddress);
      if (rpcResult) {
        this.cache.set(mintAddress, rpcResult);
        return rpcResult;
      }
      
      return null;
    } catch (error) {
      console.error(chalk.red(`Error fetching creation time for ${mintAddress}:`), error);
      return null;
    }
  }
  
  /**
   * Get creation time from Shyft transaction history
   */
  private async getCreationTimeFromShyft(mintAddress: string): Promise<TokenCreationInfo | null> {
    if (!this.shyftApiKey) return null;
    
    try {
      // Get transaction history for the token
      const response = await axios.get('https://api.shyft.to/sol/v1/transaction/history', {
        params: {
          network: 'mainnet-beta',
          account: mintAddress,
          tx_num: 1, // Just need the first transaction
          enable_raw: false
        },
        headers: {
          'x-api-key': this.shyftApiKey
        },
        timeout: 10000
      });
      
      if (response.data.success && response.data.result?.length > 0) {
        const firstTx = response.data.result[0];
        
        // Check if this is a token creation transaction
        if (firstTx.type === 'create_token' || firstTx.type === 'mint_init' || 
            firstTx.actions?.some((a: any) => a.type === 'create' || a.type === 'initializeMint')) {
          
          return {
            mintAddress,
            creationTime: new Date(firstTx.timestamp * 1000),
            creationSlot: firstTx.slot,
            creator: firstTx.fee_payer || firstTx.signers?.[0],
            source: 'shyft'
          };
        }
      }
      
      return null;
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(chalk.yellow('Shyft creation time error:'), error);
      }
      return null;
    }
  }
  
  /**
   * Get creation time from Helius
   */
  private async getCreationTimeFromHelius(mintAddress: string): Promise<TokenCreationInfo | null> {
    if (!this.heliusApiKey) return null;
    
    try {
      // Get token metadata which might include creation info
      const response = await axios.post(
        `https://api.helius.xyz/v0/tokens/metadata?api-key=${this.heliusApiKey}`,
        {
          mintAccounts: [mintAddress],
          includeOffChain: true,
          disableCache: false
        },
        { timeout: 10000 }
      );
      
      if (response.data?.[0]) {
        const metadata = response.data[0];
        
        // Helius sometimes provides onChainMetadata with creation info
        if (metadata.onChainMetadata?.metadata?.mintedAt) {
          return {
            mintAddress,
            creationTime: new Date(metadata.onChainMetadata.metadata.mintedAt),
            creationSlot: metadata.onChainMetadata.metadata.slot || 0,
            creator: metadata.onChainMetadata.metadata.updateAuthority,
            source: 'helius'
          };
        }
      }
      
      return null;
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(chalk.yellow('Helius creation time error:'), error);
      }
      return null;
    }
  }
  
  /**
   * Get creation time from RPC (slowest method)
   */
  private async getCreationTimeFromRPC(mintAddress: string): Promise<TokenCreationInfo | null> {
    try {
      const pubkey = new PublicKey(mintAddress);
      
      // Get signatures for the mint account
      const signatures = await this.connection.getSignaturesForAddress(pubkey, { limit: 1000 });
      
      if (signatures.length === 0) {
        return null;
      }
      
      // The last signature should be the oldest (creation)
      const oldestSig = signatures[signatures.length - 1];
      
      if (oldestSig.blockTime) {
        return {
          mintAddress,
          creationTime: new Date(oldestSig.blockTime * 1000),
          creationSlot: oldestSig.slot,
          source: 'rpc'
        };
      }
      
      return null;
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(chalk.yellow('RPC creation time error:'), error);
      }
      return null;
    }
  }
  
  /**
   * Update database with token creation time
   */
  async updateTokenCreationTime(mintAddress: string, creationInfo: TokenCreationInfo): Promise<void> {
    try {
      await db.query(
        `UPDATE tokens_unified 
         SET token_created_at = $2,
             creator = COALESCE(creator, $3),
             updated_at = NOW()
         WHERE mint_address = $1`,
        [mintAddress, creationInfo.creationTime, creationInfo.creator]
      );
      
      console.log(chalk.green(`✅ Updated creation time for ${mintAddress}: ${creationInfo.creationTime.toISOString()}`));
    } catch (error) {
      console.error(chalk.red('Error updating token creation time:'), error);
    }
  }
  
  /**
   * Batch update token creation times
   */
  async batchUpdateCreationTimes(mintAddresses: string[]): Promise<void> {
    console.log(chalk.cyan(`🕐 Fetching creation times for ${mintAddresses.length} tokens...`));
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const mintAddress of mintAddresses) {
      try {
        const creationInfo = await this.getTokenCreationTime(mintAddress);
        
        if (creationInfo) {
          await this.updateTokenCreationTime(mintAddress, creationInfo);
          successCount++;
        } else {
          errorCount++;
          if (process.env.DEBUG) {
            console.log(chalk.gray(`No creation time found for ${mintAddress}`));
          }
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        errorCount++;
        console.error(chalk.red(`Error processing ${mintAddress}:`), error);
      }
      
      // Progress update every 10 tokens
      if ((successCount + errorCount) % 10 === 0) {
        console.log(chalk.gray(`Progress: ${successCount + errorCount}/${mintAddresses.length} (${successCount} success, ${errorCount} errors)`));
      }
    }
    
    console.log(chalk.green(`✅ Completed: ${successCount} updated, ${errorCount} errors`));
  }
}