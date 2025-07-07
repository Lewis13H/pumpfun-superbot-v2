/**
 * Holder Analysis Job Queue Types
 */

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type JobPriority = 'low' | 'normal' | 'high' | 'critical';
export type JobType = 'single_analysis' | 'batch_analysis' | 'recurring_analysis' | 'trend_update';

export interface JobOptions {
  priority?: JobPriority;
  delay?: number;              // Delay in milliseconds before processing
  retries?: number;            // Max retry attempts
  retryDelay?: number;         // Delay between retries
  timeout?: number;            // Job timeout in milliseconds
  removeOnComplete?: boolean;  // Remove job after completion
  removeOnFail?: boolean;      // Remove job after failure
}

export interface HolderAnalysisJobData {
  type: JobType;
  mintAddress?: string;        // For single analysis
  mintAddresses?: string[];    // For batch analysis
  options?: {
    forceRefresh?: boolean;
    maxHolders?: number;
    enableTrends?: boolean;
    classifyWallets?: boolean;
    saveSnapshot?: boolean;
  };
  metadata?: Record<string, any>;
}

export interface Job<T = HolderAnalysisJobData> {
  id: string;
  type: JobType;
  data: T;
  status: JobStatus;
  priority: JobPriority;
  attempts: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  nextRetryAt?: Date;
  error?: string;
  result?: any;
  progress?: number;
  metadata?: Record<string, any>;
}

export interface JobQueue<T = HolderAnalysisJobData> {
  add(data: T, options?: JobOptions): Promise<Job<T>>;
  process(concurrency: number, processor: JobProcessor<T>): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getJob(id: string): Promise<Job<T> | null>;
  getJobs(status?: JobStatus): Promise<Job<T>[]>;
  removeJob(id: string): Promise<boolean>;
  clear(): Promise<void>;
  getStats(): Promise<QueueStats>;
}

export type JobProcessor<T = HolderAnalysisJobData> = (job: Job<T>) => Promise<any>;

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
  oldestJobAge?: number;
  averageProcessingTime?: number;
  throughput?: number;         // Jobs per minute
}

export interface RecurringJobConfig {
  id: string;
  name: string;
  schedule: string;            // Cron expression or interval
  data: HolderAnalysisJobData;
  options?: JobOptions;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
}

export interface JobEvent {
  jobId: string;
  type: 'added' | 'started' | 'progress' | 'completed' | 'failed' | 'retrying' | 'removed';
  timestamp: Date;
  data?: any;
}

export interface WorkerStats {
  id: string;
  status: 'idle' | 'busy';
  currentJob?: string;
  jobsProcessed: number;
  errors: number;
  averageProcessingTime: number;
  lastActivity: Date;
}

// Priority weights for sorting
export const PRIORITY_WEIGHTS: Record<JobPriority, number> = {
  critical: 1000,
  high: 100,
  normal: 10,
  low: 1
};

// Default job options
export const DEFAULT_JOB_OPTIONS: Required<JobOptions> = {
  priority: 'normal',
  delay: 0,
  retries: 3,
  retryDelay: 60000,           // 1 minute
  timeout: 300000,             // 5 minutes
  removeOnComplete: false,
  removeOnFail: false
};