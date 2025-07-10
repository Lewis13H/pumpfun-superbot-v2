/**
 * Advanced Pattern Detector
 * 
 * Implements sophisticated pattern detection for MEV bots,
 * coordinated trading, wash trading, and other suspicious behaviors
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../../core/logger';

export interface PatternDetectionResult {
  walletAddress: string;
  patterns: {
    mevBot: MEVPattern | null;
    washTrading: WashTradingPattern | null;
    coordinatedTrading: CoordinatedPattern | null;
    copyTrading: CopyTradingPattern | null;
    sandwichAttack: SandwichPattern | null;
  };
  riskScore: number; // 0-100
  confidence: number; // 0-1
  recommendations: string[];
}

export interface MEVPattern {
  detected: boolean;
  bundleCount: number;
  jitoUsage: boolean;
  frontrunCount: number;
  backrunCount: number;
  profitUsd: number;
  avgGasMultiple: number; // How much more gas they pay vs average
}

export interface WashTradingPattern {
  detected: boolean;
  circularTrades: number;
  selfTrades: number;
  relatedWallets: string[];
  volumeInflated: number;
  suspiciousRoutes: TradingRoute[];
}

export interface CoordinatedPattern {
  detected: boolean;
  coordinatedWallets: string[];
  simultaneousTrades: number;
  timingCorrelation: number;
  sharedFunding: boolean;
  clusterSize: number;
}

export interface CopyTradingPattern {
  detected: boolean;
  followedWallet: string | null;
  copyDelay: number; // seconds
  copyAccuracy: number; // % of trades copied
  profitCorrelation: number;
}

export interface SandwichPattern {
  detected: boolean;
  victimCount: number;
  totalProfitUsd: number;
  avgSlippage: number;
  successRate: number;
}

interface TradingRoute {
  path: string[];
  volume: number;
  frequency: number;
}

interface TransactionPattern {
  wallet: string;
  timestamp: number;
  signature: string;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  gasPrice?: number;
  bundle?: string;
  program: string;
}

export class AdvancedPatternDetector {
  private connection: Connection;
  private knownMEVWallets = new Set<string>();
  private knownBundlers = new Set<string>([
    // Jito bundlers
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    // Add more known bundlers
  ]);
  
  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl);
  }
  
  /**
   * Detect all patterns for a wallet
   */
  async detectPatterns(
    walletAddress: string,
    transactions: TransactionPattern[],
    relatedWallets?: string[]
  ): Promise<PatternDetectionResult> {
    const [
      mevPattern,
      washPattern,
      coordinatedPattern,
      copyPattern,
      sandwichPattern
    ] = await Promise.all([
      this.detectMEVActivity(walletAddress, transactions),
      this.detectWashTrading(walletAddress, transactions),
      this.detectCoordinatedTrading(walletAddress, transactions, relatedWallets),
      this.detectCopyTrading(walletAddress, transactions),
      this.detectSandwichAttacks(walletAddress, transactions)
    ]);
    
    // Calculate overall risk score
    const riskScore = this.calculateRiskScore({
      mevPattern,
      washPattern,
      coordinatedPattern,
      copyPattern,
      sandwichPattern
    });
    
    // Generate recommendations
    const recommendations = this.generateRecommendations({
      mevPattern,
      washPattern,
      coordinatedPattern,
      copyPattern,
      sandwichPattern
    });
    
    return {
      walletAddress,
      patterns: {
        mevBot: mevPattern,
        washTrading: washPattern,
        coordinatedTrading: coordinatedPattern,
        copyTrading: copyPattern,
        sandwichAttack: sandwichPattern
      },
      riskScore,
      confidence: this.calculateConfidence(transactions.length),
      recommendations
    };
  }
  
  /**
   * Detect MEV bot activity
   */
  private async detectMEVActivity(
    wallet: string,
    transactions: TransactionPattern[]
  ): Promise<MEVPattern | null> {
    let bundleCount = 0;
    let jitoUsage = false;
    let frontrunCount = 0;
    let backrunCount = 0;
    let totalProfit = 0;
    let gasMultiples: number[] = [];
    
    // Check for bundle usage
    const bundledTxs = transactions.filter(tx => tx.bundle);
    bundleCount = bundledTxs.length;
    jitoUsage = bundledTxs.some(tx => 
      tx.bundle && this.knownBundlers.has(tx.bundle)
    );
    
    // Analyze transaction timing and gas usage
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      
      // Check for frontrunning pattern
      if (i > 0 && i < transactions.length - 1) {
        const prevTx = transactions[i - 1];
        const nextTx = transactions[i + 1];
        
        // Frontrun: buy right before another buy
        if (tx.type === 'buy' && nextTx.type === 'buy' && 
            nextTx.timestamp - tx.timestamp < 5 && 
            tx.gasPrice && nextTx.gasPrice && 
            tx.gasPrice > nextTx.gasPrice * 1.5) {
          frontrunCount++;
        }
        
        // Backrun: sell right after another sell
        if (tx.type === 'sell' && prevTx.type === 'sell' && 
            tx.timestamp - prevTx.timestamp < 5) {
          backrunCount++;
        }
      }
      
      // Track gas multiples
      if (tx.gasPrice) {
        // Compare to average gas price (simplified)
        const avgGas = 0.001; // Placeholder
        gasMultiples.push(tx.gasPrice / avgGas);
      }
    }
    
    // Calculate average gas multiple
    const avgGasMultiple = gasMultiples.length > 0
      ? gasMultiples.reduce((a, b) => a + b, 0) / gasMultiples.length
      : 1;
    
    const detected = bundleCount > 5 || 
                    frontrunCount > 3 || 
                    backrunCount > 3 ||
                    avgGasMultiple > 2;
    
    if (!detected) return null;
    
    return {
      detected,
      bundleCount,
      jitoUsage,
      frontrunCount,
      backrunCount,
      profitUsd: totalProfit,
      avgGasMultiple
    };
  }
  
  /**
   * Detect wash trading patterns
   */
  private async detectWashTrading(
    wallet: string,
    transactions: TransactionPattern[]
  ): Promise<WashTradingPattern | null> {
    const tradingPairs = new Map<string, number>();
    const routes: TradingRoute[] = [];
    let circularTrades = 0;
    let selfTrades = 0;
    
    // Build trading graph
    const tradingGraph = new Map<string, Set<string>>();
    
    for (let i = 0; i < transactions.length - 1; i++) {
      const tx1 = transactions[i];
      const tx2 = transactions[i + 1];
      
      // Check for immediate buy-sell pattern
      if (tx1.type === 'buy' && tx2.type === 'sell' && 
          tx2.timestamp - tx1.timestamp < 300) { // 5 minutes
        circularTrades++;
      }
      
      // Track trading pairs (simplified - would need counterparty data)
      const pair = `${tx1.type}-${tx2.type}`;
      tradingPairs.set(pair, (tradingPairs.get(pair) || 0) + 1);
    }
    
    // Detect circular routes (simplified)
    const hasCircularPattern = circularTrades > 5 || 
      (tradingPairs.get('buy-sell') || 0) > 10;
    
    if (!hasCircularPattern) return null;
    
    return {
      detected: true,
      circularTrades,
      selfTrades,
      relatedWallets: [], // Would need graph analysis
      volumeInflated: circularTrades * 2, // Simplified
      suspiciousRoutes: routes
    };
  }
  
  /**
   * Detect coordinated trading
   */
  private async detectCoordinatedTrading(
    wallet: string,
    transactions: TransactionPattern[],
    relatedWallets?: string[]
  ): Promise<CoordinatedPattern | null> {
    if (!relatedWallets || relatedWallets.length === 0) return null;
    
    // Time-based clustering
    const timeWindows = new Map<number, TransactionPattern[]>();
    
    transactions.forEach(tx => {
      const window = Math.floor(tx.timestamp / 60); // 1-minute windows
      if (!timeWindows.has(window)) {
        timeWindows.set(window, []);
      }
      timeWindows.get(window)!.push(tx);
    });
    
    // Count simultaneous trades
    let simultaneousTrades = 0;
    timeWindows.forEach(txs => {
      if (txs.length > 3) { // Multiple trades in same minute
        simultaneousTrades++;
      }
    });
    
    // Calculate timing correlation (simplified)
    const avgInterval = transactions.length > 1
      ? (transactions[transactions.length - 1].timestamp - transactions[0].timestamp) / transactions.length
      : 0;
    
    const timingCorrelation = avgInterval > 0 && avgInterval < 60 ? 0.8 : 0.2;
    
    const detected = simultaneousTrades > 5 || timingCorrelation > 0.7;
    
    if (!detected) return null;
    
    return {
      detected,
      coordinatedWallets: relatedWallets,
      simultaneousTrades,
      timingCorrelation,
      sharedFunding: false, // Would need funding analysis
      clusterSize: relatedWallets.length + 1
    };
  }
  
  /**
   * Detect copy trading
   */
  private async detectCopyTrading(
    wallet: string,
    transactions: TransactionPattern[]
  ): Promise<CopyTradingPattern | null> {
    // This would require comparing with other wallets' transactions
    // Simplified implementation
    
    const buyTimings = transactions
      .filter(tx => tx.type === 'buy')
      .map(tx => tx.timestamp);
    
    if (buyTimings.length < 3) return null;
    
    // Check for consistent delay patterns
    const delays: number[] = [];
    for (let i = 1; i < buyTimings.length; i++) {
      delays.push(buyTimings[i] - buyTimings[i - 1]);
    }
    
    // Calculate delay consistency
    const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
    const delayVariance = delays.reduce((sum, d) => sum + Math.pow(d - avgDelay, 2), 0) / delays.length;
    const delayStdDev = Math.sqrt(delayVariance);
    
    // Low standard deviation suggests automated copying
    const isAutomated = delayStdDev < avgDelay * 0.2;
    
    if (!isAutomated) return null;
    
    return {
      detected: true,
      followedWallet: null, // Would need comparison with leader wallet
      copyDelay: avgDelay,
      copyAccuracy: 0.85, // Placeholder
      profitCorrelation: 0.75 // Placeholder
    };
  }
  
  /**
   * Detect sandwich attacks
   */
  private async detectSandwichAttacks(
    wallet: string,
    transactions: TransactionPattern[]
  ): Promise<SandwichPattern | null> {
    let sandwichCount = 0;
    let totalProfit = 0;
    let slippages: number[] = [];
    
    // Look for sandwich pattern: buy -> victim tx -> sell
    for (let i = 0; i < transactions.length - 2; i++) {
      const tx1 = transactions[i];
      const tx2 = transactions[i + 1];
      const tx3 = transactions[i + 2];
      
      if (tx1.type === 'buy' && tx3.type === 'sell' &&
          tx3.timestamp - tx1.timestamp < 60 && // Within 1 minute
          Math.abs(tx1.amount - tx3.amount) < tx1.amount * 0.1) { // Similar amounts
        
        sandwichCount++;
        
        // Calculate profit
        const profit = (tx3.price - tx1.price) * tx3.amount;
        totalProfit += profit;
        
        // Estimate slippage imposed on victim
        const slippage = (tx3.price - tx1.price) / tx1.price;
        slippages.push(slippage);
      }
    }
    
    if (sandwichCount === 0) return null;
    
    const avgSlippage = slippages.reduce((a, b) => a + b, 0) / slippages.length;
    const successRate = sandwichCount / (transactions.length / 3);
    
    return {
      detected: true,
      victimCount: sandwichCount,
      totalProfitUsd: totalProfit,
      avgSlippage,
      successRate
    };
  }
  
  /**
   * Calculate overall risk score
   */
  private calculateRiskScore(patterns: any): number {
    let score = 0;
    
    // MEV activity
    if (patterns.mevPattern?.detected) {
      score += 25;
      if (patterns.mevPattern.frontrunCount > 10) score += 10;
    }
    
    // Wash trading
    if (patterns.washPattern?.detected) {
      score += 30;
      if (patterns.washPattern.circularTrades > 20) score += 15;
    }
    
    // Coordinated trading
    if (patterns.coordinatedPattern?.detected) {
      score += 20;
      if (patterns.coordinatedPattern.clusterSize > 5) score += 10;
    }
    
    // Copy trading (less risky)
    if (patterns.copyPattern?.detected) {
      score += 10;
    }
    
    // Sandwich attacks
    if (patterns.sandwichPattern?.detected) {
      score += 35;
      if (patterns.sandwichPattern.victimCount > 10) score += 15;
    }
    
    return Math.min(100, score);
  }
  
  /**
   * Generate recommendations based on patterns
   */
  private generateRecommendations(patterns: any): string[] {
    const recommendations: string[] = [];
    
    if (patterns.mevPattern?.detected) {
      recommendations.push('High MEV activity detected - this wallet may be a bot');
      if (patterns.mevPattern.jitoUsage) {
        recommendations.push('Uses Jito bundles for transaction ordering');
      }
    }
    
    if (patterns.washPattern?.detected) {
      recommendations.push('Wash trading patterns detected - inflated volume likely');
      recommendations.push('Be cautious of artificial price movements');
    }
    
    if (patterns.coordinatedPattern?.detected) {
      recommendations.push(`Part of coordinated group with ${patterns.coordinatedPattern.clusterSize} wallets`);
      recommendations.push('Trading activity may be manipulated');
    }
    
    if (patterns.sandwichPattern?.detected) {
      recommendations.push('Sandwich attack patterns detected - predatory trader');
      recommendations.push(`Average slippage imposed: ${(patterns.sandwichPattern.avgSlippage * 100).toFixed(1)}%`);
    }
    
    if (recommendations.length === 0) {
      recommendations.push('No significant suspicious patterns detected');
    }
    
    return recommendations;
  }
  
  /**
   * Calculate confidence based on data availability
   */
  private calculateConfidence(txCount: number): number {
    if (txCount < 10) return 0.3;
    if (txCount < 50) return 0.6;
    if (txCount < 100) return 0.8;
    return 0.95;
  }
}