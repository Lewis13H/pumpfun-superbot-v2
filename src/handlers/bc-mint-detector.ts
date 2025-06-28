/**
 * Bonding Curve Mint Detector
 * 
 * Detects new token mints from pump.fun transactions
 * Extracts token addresses, creator info, and initial metadata
 */

import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import chalk from 'chalk';

/**
 * New mint detection result
 */
export interface NewMintDetection {
  mintAddress: string;
  creator: string;
  signature: string;
  slot: bigint;
  blockTime?: Date;
  initialSupply?: number;
  isNewToken: boolean;
  metadata?: {
    name?: string;
    symbol?: string;
    uri?: string;
  };
}

/**
 * Token balance change info
 */
interface TokenBalanceInfo {
  mint: string;
  owner: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}

/**
 * Detect new token mints from transaction data
 */
export class BondingCurveMintDetector {
  private seenMints: Set<string> = new Set();
  private stats = {
    newTokensDetected: 0,
    existingTokensSeen: 0,
    detectionsProcessed: 0,
    errors: 0
  };

  /**
   * Check if a transaction contains a new token mint
   */
  detectNewMint(transactionData: any): NewMintDetection | null {
    try {
      // Extract signature
      const signature = this.extractSignature(transactionData);
      
      // Check logs for pump.fun creation
      const logs = this.extractLogs(transactionData);
      if (!logs || !this.isPumpFunCreation(logs)) {
        return null;
      }

      // Extract post token balances
      const postTokenBalances = this.extractPostTokenBalances(transactionData);
      if (!postTokenBalances || postTokenBalances.length === 0) {
        return null;
      }

      // Find the new mint (usually the first non-SOL balance)
      const newMint = this.findNewMint(postTokenBalances);
      if (!newMint) {
        return null;
      }

      // Check if we've seen this mint before
      const isNewToken = !this.seenMints.has(newMint.mint);
      this.seenMints.add(newMint.mint);

      // Extract creator from account keys
      const creator = this.extractCreator(transactionData, logs);
      
      // Extract slot and block time
      const slot = this.extractSlot(transactionData);
      const blockTime = this.extractBlockTime(transactionData);

      // Extract metadata if available
      const metadata = this.extractMetadata(logs);

      // Update stats
      this.stats.detectionsProcessed++;
      if (isNewToken) {
        this.stats.newTokensDetected++;
      } else {
        this.stats.existingTokensSeen++;
      }

      return {
        mintAddress: newMint.mint,
        creator: creator || 'unknown',
        signature,
        slot: slot || BigInt(0),
        blockTime,
        initialSupply: newMint.uiTokenAmount.uiAmount || undefined,
        isNewToken,
        metadata
      };
    } catch (error) {
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Check if logs indicate a pump.fun token creation
   */
  private isPumpFunCreation(logs: string[]): boolean {
    return logs.some(log => 
      log.includes('create') || 
      log.includes('initialize') ||
      log.includes('InitializeMint') ||
      (log.includes('pump') && log.includes('success'))
    );
  }

  /**
   * Extract post token balances from transaction
   */
  private extractPostTokenBalances(transactionData: any): TokenBalanceInfo[] | null {
    try {
      // Check different possible locations
      const meta = transactionData?.transaction?.meta || 
                   transactionData?.meta ||
                   transactionData?.transaction?.transaction?.meta;
      
      if (meta?.postTokenBalances) {
        return meta.postTokenBalances;
      }
      
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Find the new mint from token balances
   */
  private findNewMint(balances: TokenBalanceInfo[]): TokenBalanceInfo | null {
    // Look for a balance with high supply (likely the initial mint)
    for (const balance of balances) {
      if (balance.mint && balance.uiTokenAmount) {
        const amount = parseFloat(balance.uiTokenAmount.uiAmountString);
        // New tokens typically have 1B supply
        if (amount > 100_000_000) {
          return balance;
        }
      }
    }
    
    // Fallback: return first non-zero balance
    return balances.find(b => 
      b.mint && 
      b.uiTokenAmount && 
      parseFloat(b.uiTokenAmount.uiAmountString) > 0
    ) || null;
  }

  /**
   * Extract creator address from transaction
   */
  private extractCreator(transactionData: any, logs: string[]): string | null {
    try {
      // Try to find creator from logs
      for (const log of logs) {
        const match = log.match(/creator[:\s]+([A-Za-z0-9]{32,44})/i);
        if (match?.[1]) {
          return match[1];
        }
      }

      // Fallback: get the fee payer (usually the creator)
      const accountKeys = this.extractAccountKeys(transactionData);
      if (accountKeys && accountKeys.length > 0) {
        // First account is typically the fee payer/signer
        const firstAccount = accountKeys[0];
        if (firstAccount) {
          return typeof firstAccount === 'string' 
            ? firstAccount 
            : new PublicKey(firstAccount).toString();
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract account keys from transaction
   */
  private extractAccountKeys(transactionData: any): (string | Buffer)[] | null {
    try {
      // Navigate through nested structure
      const keys = transactionData?.transaction?.transaction?.message?.accountKeys ||
                   transactionData?.transaction?.message?.accountKeys ||
                   transactionData?.message?.accountKeys;
      
      return keys || null;
    } catch {
      return null;
    }
  }

  /**
   * Extract metadata from logs
   */
  private extractMetadata(logs: string[]): NewMintDetection['metadata'] | undefined {
    const metadata: NewMintDetection['metadata'] = {};
    
    for (const log of logs) {
      // Look for name
      const nameMatch = log.match(/name[:\s]+["']?([^"',]+)["']?/i);
      if (nameMatch?.[1]) {
        metadata.name = nameMatch[1].trim();
      }
      
      // Look for symbol
      const symbolMatch = log.match(/symbol[:\s]+["']?([A-Z0-9$]+)["']?/i);
      if (symbolMatch?.[1]) {
        metadata.symbol = symbolMatch[1].trim();
      }
      
      // Look for metadata URI
      const uriMatch = log.match(/uri[:\s]+["']?(https?:\/\/[^\s"']+)["']?/i);
      if (uriMatch?.[1]) {
        metadata.uri = uriMatch[1];
      }
    }
    
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  /**
   * Extract logs from transaction data
   */
  private extractLogs(transactionData: any): string[] | null {
    try {
      // Handle nested transaction structure from gRPC
      if (transactionData?.transaction?.meta?.logMessages) {
        return transactionData.transaction.meta.logMessages;
      }
      if (transactionData?.meta?.logMessages) {
        return transactionData.meta.logMessages;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract signature from transaction
   */
  private extractSignature(transactionData: any): string {
    try {
      // Try different structures
      if (transactionData?.transaction?.transaction?.signatures?.[0]) {
        const sig = transactionData.transaction.transaction.signatures[0];
        return typeof sig === 'string' ? sig : bs58.encode(sig);
      }
      if (transactionData?.transaction?.signatures?.[0]) {
        const sig = transactionData.transaction.signatures[0];
        return typeof sig === 'string' ? sig : bs58.encode(sig);
      }
      if (transactionData?.signatures?.[0]) {
        const sig = transactionData.signatures[0];
        return typeof sig === 'string' ? sig : bs58.encode(sig);
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Extract slot from transaction
   */
  private extractSlot(transactionData: any): bigint | undefined {
    try {
      const slot = transactionData?.slot || 
                   transactionData?.transaction?.slot ||
                   transactionData?.transaction?.transaction?.slot;
      
      if (slot !== undefined && slot !== null) {
        return BigInt(slot);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Extract block time from transaction
   */
  private extractBlockTime(transactionData: any): Date | undefined {
    try {
      const meta = transactionData?.transaction?.meta || transactionData?.meta;
      const blockTime = meta?.blockTime || transactionData?.blockTime;
      
      if (blockTime) {
        return new Date(blockTime * 1000);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Log new token detection
   */
  logNewTokenDetection(detection: NewMintDetection): void {
    console.log(chalk.green.bold('\n🚀 NEW TOKEN DETECTED! 🚀'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Mint: ${chalk.yellow(detection.mintAddress)}`);
    console.log(`Creator: ${chalk.cyan(detection.creator)}`);
    
    if (detection.metadata) {
      if (detection.metadata.name) {
        console.log(`Name: ${chalk.white(detection.metadata.name)}`);
      }
      if (detection.metadata.symbol) {
        console.log(`Symbol: ${chalk.white(detection.metadata.symbol)}`);
      }
      if (detection.metadata.uri) {
        console.log(`URI: ${chalk.blue(detection.metadata.uri)}`);
      }
    }
    
    if (detection.initialSupply) {
      console.log(`Supply: ${chalk.green(detection.initialSupply.toLocaleString())}`);
    }
    
    console.log(`Signature: ${chalk.gray(detection.signature.slice(0, 16) + '...')}`);
    console.log(chalk.gray('─'.repeat(50)));
  }

  /**
   * Get detection statistics
   */
  getStats() {
    return {
      ...this.stats,
      uniqueMints: this.seenMints.size
    };
  }

  /**
   * Reset seen mints cache (for testing)
   */
  resetCache(): void {
    this.seenMints.clear();
  }
}