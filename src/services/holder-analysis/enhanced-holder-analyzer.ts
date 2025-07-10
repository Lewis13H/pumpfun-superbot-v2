/**
 * Enhanced Holder Analyzer
 * 
 * Implements advanced holder analysis with transaction history,
 * profit/loss calculation, and behavioral pattern detection
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { HeliusApiClient } from './helius-api-client';
import { logger } from '../../core/logger';

export interface TransactionData {
  signature: string;
  blockTime: number;
  type: 'buy' | 'sell' | 'transfer';
  tokenAmount: string;
  solAmount: string;
  pricePerToken: number;
  totalValue: number;
  slot: number;
}

export interface HolderMetrics {
  // Basic info
  address: string;
  currentBalance: string;
  balanceUsd: number;
  
  // Transaction history
  firstPurchase: TransactionData | null;
  lastTransaction: TransactionData | null;
  transactionCount: number;
  
  // Trading metrics
  totalBought: string;
  totalSold: string;
  avgBuyPrice: number;
  avgSellPrice: number;
  
  // P&L metrics
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  profitMultiple: number;
  
  // Behavioral metrics
  holdingDays: number;
  isSelling: boolean;
  isAccumulating: boolean;
  neverSold: boolean;
  panicSold: boolean;
  
  // Pattern detection
  entryTiming: 'sniper' | 'early' | 'normal' | 'late';
  tradingPattern: 'holder' | 'trader' | 'bot' | 'whale';
  riskProfile: 'conservative' | 'moderate' | 'aggressive';
}

export interface TokenContext {
  mintAddress: string;
  creationTime: number;
  currentPrice: number;
  ath: number;
  atl: number;
  decimals: number;
}

export class EnhancedHolderAnalyzer {
  private connection: Connection;
  private helius: HeliusApiClient;
  
  constructor(
    rpcUrl: string,
    heliusApiKey?: string
  ) {
    this.connection = new Connection(rpcUrl);
    this.helius = new HeliusApiClient(heliusApiKey);
  }
  
  /**
   * Analyze a holder with full transaction history
   */
  async analyzeHolder(
    holderAddress: string,
    tokenContext: TokenContext
  ): Promise<HolderMetrics> {
    try {
      // Fetch transaction history
      const transactions = await this.fetchHolderTransactions(
        holderAddress,
        tokenContext.mintAddress
      );
      
      // Sort by time
      transactions.sort((a, b) => a.blockTime - b.blockTime);
      
      // Calculate metrics
      const metrics = this.calculateMetrics(
        holderAddress,
        transactions,
        tokenContext
      );
      
      return metrics;
    } catch (error) {
      logger.error(`Failed to analyze holder ${holderAddress}:`, error);
      throw error;
    }
  }
  
  /**
   * Fetch all transactions for a holder/token pair
   */
  private async fetchHolderTransactions(
    holderAddress: string,
    mintAddress: string
  ): Promise<TransactionData[]> {
    const transactions: TransactionData[] = [];
    
    // Use Helius for transaction history
    const history = await this.helius.getWalletTransactions(holderAddress, {
      type: ['TOKEN_TRANSFER'],
      source: ['SYSTEM_PROGRAM', 'TOKEN_PROGRAM'],
      mint: mintAddress
    });
    
    for (const tx of history) {
      const parsed = this.parseTransaction(tx, holderAddress, mintAddress);
      if (parsed) {
        transactions.push(parsed);
      }
    }
    
    return transactions;
  }
  
  /**
   * Parse raw transaction into structured data
   */
  private parseTransaction(
    tx: any,
    holderAddress: string,
    mintAddress: string
  ): TransactionData | null {
    try {
      // Determine transaction type
      const isBuy = tx.tokenTransfers?.some(
        (t: any) => t.toUserAccount === holderAddress && t.mint === mintAddress
      );
      const isSell = tx.tokenTransfers?.some(
        (t: any) => t.fromUserAccount === holderAddress && t.mint === mintAddress
      );
      
      if (!isBuy && !isSell) return null;
      
      // Extract amounts
      const tokenTransfer = tx.tokenTransfers.find(
        (t: any) => t.mint === mintAddress
      );
      const solTransfer = tx.nativeTransfers?.find(
        (t: any) => t.fromUserAccount === holderAddress || t.toUserAccount === holderAddress
      );
      
      const tokenAmount = tokenTransfer?.tokenAmount || '0';
      const solAmount = solTransfer?.amount || 0;
      
      // Calculate price
      const pricePerToken = solAmount > 0 && parseFloat(tokenAmount) > 0
        ? solAmount / parseFloat(tokenAmount)
        : 0;
      
      return {
        signature: tx.signature,
        blockTime: tx.timestamp,
        type: isBuy ? 'buy' : 'sell',
        tokenAmount,
        solAmount: solAmount.toString(),
        pricePerToken,
        totalValue: solAmount,
        slot: tx.slot
      };
    } catch (error) {
      logger.debug('Failed to parse transaction:', error);
      return null;
    }
  }
  
  /**
   * Calculate comprehensive metrics from transactions
   */
  private calculateMetrics(
    holderAddress: string,
    transactions: TransactionData[],
    context: TokenContext
  ): HolderMetrics {
    // Separate buys and sells
    const buys = transactions.filter(tx => tx.type === 'buy');
    const sells = transactions.filter(tx => tx.type === 'sell');
    
    // Calculate totals
    const totalBought = buys.reduce(
      (sum, tx) => sum + BigInt(tx.tokenAmount), 
      BigInt(0)
    );
    const totalSold = sells.reduce(
      (sum, tx) => sum + BigInt(tx.tokenAmount),
      BigInt(0)
    );
    
    // Current balance
    const currentBalance = (totalBought - totalSold).toString();
    const balanceUsd = parseFloat(currentBalance) * context.currentPrice / Math.pow(10, context.decimals);
    
    // Calculate average prices
    const totalBuyValue = buys.reduce((sum, tx) => sum + tx.totalValue, 0);
    const totalSellValue = sells.reduce((sum, tx) => sum + tx.totalValue, 0);
    const avgBuyPrice = buys.length > 0 ? totalBuyValue / buys.length : 0;
    const avgSellPrice = sells.length > 0 ? totalSellValue / sells.length : 0;
    
    // P&L calculations
    const realizedPnL = totalSellValue - (totalBuyValue * Number(totalSold) / Number(totalBought));
    const costBasis = totalBuyValue * Number(currentBalance) / Number(totalBought);
    const unrealizedPnL = balanceUsd - costBasis;
    const totalPnL = realizedPnL + unrealizedPnL;
    const profitMultiple = costBasis > 0 ? (costBasis + totalPnL) / costBasis : 0;
    
    // Behavioral analysis
    const firstPurchase = buys[0] || null;
    const lastTransaction = transactions[transactions.length - 1] || null;
    const holdingDays = firstPurchase 
      ? (Date.now() - firstPurchase.blockTime * 1000) / (1000 * 60 * 60 * 24)
      : 0;
    
    // Entry timing
    const entryDelay = firstPurchase 
      ? (firstPurchase.blockTime * 1000 - context.creationTime) / 1000
      : Infinity;
    let entryTiming: HolderMetrics['entryTiming'] = 'normal';
    if (entryDelay < 300) entryTiming = 'sniper';
    else if (entryDelay < 3600) entryTiming = 'early';
    else if (entryDelay > 86400) entryTiming = 'late';
    
    // Trading pattern
    let tradingPattern: HolderMetrics['tradingPattern'] = 'holder';
    if (sells.length === 0 && holdingDays > 7) tradingPattern = 'holder';
    else if (transactions.length > 20) tradingPattern = 'bot';
    else if (balanceUsd > 100000) tradingPattern = 'whale';
    else if (sells.length > buys.length) tradingPattern = 'trader';
    
    // Risk profile
    const maxLoss = Math.min(...sells.map(s => (s.pricePerToken - avgBuyPrice) / avgBuyPrice));
    let riskProfile: HolderMetrics['riskProfile'] = 'moderate';
    if (maxLoss < -0.3) riskProfile = 'conservative'; // Sold at 30%+ loss
    else if (sells.length === 0 && unrealizedPnL < -0.5 * costBasis) riskProfile = 'aggressive';
    
    return {
      address: holderAddress,
      currentBalance,
      balanceUsd,
      firstPurchase,
      lastTransaction,
      transactionCount: transactions.length,
      totalBought: totalBought.toString(),
      totalSold: totalSold.toString(),
      avgBuyPrice,
      avgSellPrice,
      realizedPnL,
      unrealizedPnL,
      totalPnL,
      profitMultiple,
      holdingDays,
      isSelling: lastTransaction?.type === 'sell',
      isAccumulating: buys.length > sells.length && buys.length > 2,
      neverSold: sells.length === 0,
      panicSold: maxLoss < -0.3,
      entryTiming,
      tradingPattern,
      riskProfile
    };
  }
  
  /**
   * Batch analyze multiple holders
   */
  async analyzeHolders(
    holders: string[],
    tokenContext: TokenContext,
    options: {
      maxConcurrent?: number;
      onProgress?: (progress: number) => void;
    } = {}
  ): Promise<Map<string, HolderMetrics>> {
    const { maxConcurrent = 3, onProgress } = options;
    const results = new Map<string, HolderMetrics>();
    
    // Process in batches
    for (let i = 0; i < holders.length; i += maxConcurrent) {
      const batch = holders.slice(i, i + maxConcurrent);
      
      const batchResults = await Promise.allSettled(
        batch.map(holder => this.analyzeHolder(holder, tokenContext))
      );
      
      batchResults.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          results.set(batch[idx], result.value);
        }
      });
      
      if (onProgress) {
        onProgress(Math.min(100, ((i + maxConcurrent) / holders.length) * 100));
      }
      
      // Rate limiting
      if (i + maxConcurrent < holders.length) {
        await this.delay(1000);
      }
    }
    
    return results;
  }
  
  /**
   * Generate holder quality score based on metrics
   */
  calculateHolderQuality(metrics: HolderMetrics): number {
    let score = 50; // Base score
    
    // Positive factors
    if (metrics.neverSold && metrics.holdingDays > 7) score += 20;
    if (metrics.profitMultiple > 2) score += 15;
    if (metrics.isAccumulating) score += 10;
    if (metrics.entryTiming === 'normal' || metrics.entryTiming === 'late') score += 10;
    if (metrics.tradingPattern === 'holder') score += 15;
    
    // Negative factors
    if (metrics.entryTiming === 'sniper') score -= 20;
    if (metrics.panicSold) score -= 15;
    if (metrics.tradingPattern === 'bot') score -= 25;
    if (metrics.profitMultiple < 0.5) score -= 10;
    
    return Math.max(0, Math.min(100, score));
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}