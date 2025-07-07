/**
 * Holder Analysis Types
 * 
 * Core types and interfaces for the token holder analysis system
 */

// Wallet classification types
export type WalletClassification = 'sniper' | 'bot' | 'bundler' | 'developer' | 'whale' | 'normal' | 'unknown';

export type WalletSubClassification = 
  | 'jito_bundler'
  | 'mev_bot'
  | 'copy_trader'
  | 'pump_bot'
  | 'early_sniper'
  | 'late_sniper'
  | 'team_wallet'
  | 'marketing_wallet'
  | 'exchange_wallet'
  | undefined;

// Time window types for trend analysis
export type TimeWindow = '1h' | '6h' | '24h' | '7d' | '30d';

// Analysis status types
export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

// Analysis trigger types
export type AnalysisType = 'initial' | 'scheduled' | 'manual' | 'threshold_triggered';

// Score breakdown interface
export interface HolderScoreBreakdown {
  base: number;
  distributionScore: number;
  decentralizationScore: number;
  organicGrowthScore: number;
  developerEthicsScore: number;
  sniperPenalty: number;
  botPenalty: number;
  bundlerPenalty: number;
  concentrationPenalty: number;
  total: number;
}

// Holder counts by type
export interface HolderCounts {
  total: number;
  organic: number;
  snipers: number;
  bots: number;
  bundlers: number;
  developers: number;
  whales: number;
}

// Holding percentages by wallet type
export interface HoldingPercentages {
  organic: number;
  snipers: number;
  bots: number;
  bundlers: number;
  developers: number;
  whales: number;
}

// Distribution metrics
export interface DistributionMetrics {
  top10Percentage: number;
  top25Percentage: number;
  top100Percentage: number;
  giniCoefficient: number;
  herfindahlIndex: number;
  averageHoldingDuration: number;
  medianHoldingDuration: number;
}

// Growth metrics
export interface GrowthMetrics {
  holderGrowthRate24h: number;
  holderGrowthRate7d: number;
  churnRate24h: number;
  churnRate7d: number;
  newHolders24h: number;
  exitedHolders24h: number;
}

// Wallet detection metadata
export interface WalletDetectionMetadata {
  detectionMethod: string[];
  confidenceFactors: {
    tradingPattern?: number;
    timing?: number;
    association?: number;
    behavior?: number;
  };
  firstSeenBlock?: number;
  associatedWallets?: string[];
  detectedPatterns?: string[];
}

// Holder snapshot interface (maps to holder_snapshots table)
export interface HolderSnapshot {
  id?: number;
  mintAddress: string;
  snapshotTime: Date;
  totalHolders: number;
  uniqueHolders: number;
  top10Percentage: number;
  top25Percentage: number;
  top100Percentage: number;
  giniCoefficient: number;
  herfindahlIndex: number;
  holderScore: number;
  scoreBreakdown: HolderScoreBreakdown;
  rawDataHash?: string;
  createdAt?: Date;
}

// Wallet classification interface (maps to wallet_classifications table)
export interface WalletClassificationData {
  walletAddress: string;
  classification: WalletClassification;
  subClassification?: WalletSubClassification;
  confidenceScore: number;
  detectionMetadata: WalletDetectionMetadata;
  firstSeen: Date;
  lastActivity?: Date;
  totalTokensTraded: number;
  suspiciousActivityCount: number;
  updatedAt: Date;
}

// Token holder details interface (maps to token_holder_details table)
export interface TokenHolderDetails {
  id?: number;
  mintAddress: string;
  walletAddress: string;
  balance: bigint;
  percentageHeld: number;
  rank: number;
  firstAcquired?: Date;
  lastTransaction?: Date;
  transactionCount: number;
  realizedProfitSol?: number;
  unrealizedProfitSol?: number;
  isLocked: boolean;
  updatedAt: Date;
}

// Holder analysis metadata interface (maps to holder_analysis_metadata table)
export interface HolderAnalysisMetadata {
  id?: number;
  mintAddress: string;
  analysisType: AnalysisType;
  status: AnalysisStatus;
  startedAt?: Date;
  completedAt?: Date;
  holdersAnalyzed?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

// Holder trends interface (maps to holder_trends table)
export interface HolderTrends {
  id?: number;
  mintAddress: string;
  timeWindow: TimeWindow;
  holderCountChange: number;
  holderGrowthRate: number;
  avgHolderDurationHours: number;
  churnRate: number;
  newWhaleCount: number;
  newSniperCount: number;
  calculatedAt: Date;
}

// Complete token holder analysis result
export interface TokenHolderAnalysis {
  mintAddress: string;
  analysisTimestamp: Date;
  holderCounts: HolderCounts;
  holdingPercentages: HoldingPercentages;
  distributionMetrics: DistributionMetrics;
  growthMetrics: GrowthMetrics;
  holderScore: number;
  scoreBreakdown: HolderScoreBreakdown;
  topHolders: TokenHolderDetails[];
  classifiedWallets: {
    snipers: WalletClassificationData[];
    bots: WalletClassificationData[];
    bundlers: WalletClassificationData[];
    developers: WalletClassificationData[];
    whales: WalletClassificationData[];
  };
  trends: {
    [K in TimeWindow]?: HolderTrends;
  };
}

// Holder analysis configuration
export interface HolderAnalysisConfig {
  marketCapThreshold: number; // Default: 18888
  solThreshold: number; // Default: 125
  enableAutoAnalysis: boolean;
  analysisInterval: number; // In minutes
  maxConcurrentAnalyses: number;
  scoreWeights: {
    distribution: number;
    decentralization: number;
    organicGrowth: number;
    developerEthics: number;
  };
  detectionThresholds: {
    whaleMinPercentage: number;
    sniperTimeWindowSeconds: number;
    botTradingPatternThreshold: number;
  };
}

// API response types
export interface HolderAnalysisResponse {
  success: boolean;
  data?: TokenHolderAnalysis;
  error?: string;
  timestamp: Date;
}

export interface HolderSnapshotHistory {
  mintAddress: string;
  snapshots: HolderSnapshot[];
  latestScore: number;
  scoreChange24h: number;
  scoreChange7d: number;
}

// Queue job data types
export interface HolderAnalysisJobData {
  mintAddress: string;
  priority: 'high' | 'medium' | 'low';
  analysisType: AnalysisType;
  forceRefresh?: boolean;
  metadata?: Record<string, any>;
}