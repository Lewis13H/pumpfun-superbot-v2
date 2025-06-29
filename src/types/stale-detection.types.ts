/**
 * Types for Stale Token Detection System
 */

export interface StaleToken {
  mintAddress: string;
  symbol?: string;
  name?: string;
  lastTradeTime?: Date;
  lastUpdateTime?: Date;
  marketCapUsd: number;
  staleDuration: number; // minutes since last update
  priority: number; // 1-100, higher = more urgent
}

export interface StaleDetectionConfig {
  // Stale thresholds
  staleThresholdMinutes: number; // Default: 30 minutes
  criticalStaleMinutes: number; // Default: 60 minutes
  
  // Market cap thresholds for priority
  criticalMarketCap: number; // Default: $50,000
  highMarketCap: number; // Default: $20,000
  mediumMarketCap: number; // Default: $10,000
  lowMarketCap: number; // Default: $5,000
  
  // Operational settings
  scanIntervalMinutes: number; // Default: 5 minutes
  batchSize: number; // Default: 100 tokens per recovery batch
  maxConcurrentRecoveries: number; // Default: 3
  
  // Startup recovery
  enableStartupRecovery: boolean; // Default: true
  startupRecoveryThresholdMinutes: number; // Default: 5 minutes
}

export interface RecoveryQueueItem {
  mintAddress: string;
  priority: number;
  attempts: number;
  lastAttempt?: Date;
  error?: string;
  addedAt: Date;
}

export interface RecoveryResult {
  mintAddress: string;
  success: boolean;
  priceUpdated: boolean;
  newPriceUsd?: number;
  newMarketCapUsd?: number;
  error?: string;
  duration: number; // milliseconds
}

export interface RecoveryBatch {
  batchId: string;
  startTime: Date;
  endTime?: Date;
  tokensChecked: number;
  tokensRecovered: number;
  tokensFailed: number;
  graphqlQueries: number;
  totalDuration?: number; // milliseconds
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

export interface StaleDetectionStats {
  lastScanTime?: Date;
  totalTokensScanned: number;
  staleTokensFound: number;
  tokensRecovered: number;
  recoverySuccessRate: number;
  averageRecoveryTime: number; // milliseconds
  graphqlQueriesUsed: number;
  currentQueueDepth: number;
}