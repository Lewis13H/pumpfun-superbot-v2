/**
 * Multi-Region Manager Service
 * Manages connections across multiple geographic regions for redundancy
 */

import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import axios from 'axios';

export interface RegionEndpoint {
  name: string;
  url: string;
  location: string;
  priority: number;
  healthy: boolean;
  latency: number;
  lastCheck: Date;
  failures: number;
}

export interface RegionConfig {
  regions: RegionEndpoint[];
  healthCheckInterval: number;
  latencyThreshold: number;
  maxFailures: number;
  autoFailover: boolean;
}

export interface HealthCheckResult {
  region: string;
  healthy: boolean;
  latency: number;
  error?: string;
  timestamp: Date;
}

export interface FailoverEvent {
  fromRegion: string;
  toRegion: string;
  reason: string;
  timestamp: Date;
  automatic: boolean;
}

export class MultiRegionManager {
  private static instance: MultiRegionManager;
  private logger: Logger;
  private eventBus: EventBus;
  
  private config: RegionConfig;
  private currentRegion?: RegionEndpoint;
  private healthCheckInterval?: NodeJS.Timeout;
  private failoverHistory: FailoverEvent[] = [];
  
  // Performance tracking
  private latencyHistory: Map<string, number[]> = new Map();
  private regionStats: Map<string, {
    totalRequests: number;
    successfulRequests: number;
    totalLatency: number;
    lastSuccess: Date;
  }> = new Map();

  private constructor(eventBus: EventBus, config?: Partial<RegionConfig>) {
    this.logger = new Logger({ context: 'MultiRegionManager' });
    this.eventBus = eventBus;
    
    // Default configuration
    this.config = {
      regions: [
        {
          name: 'us-east',
          url: process.env.SHYFT_GRPC_ENDPOINT || 'https://grpc.ams.shyft.to',
          location: 'US East',
          priority: 1,
          healthy: true,
          latency: 0,
          lastCheck: new Date(),
          failures: 0
        },
        {
          name: 'eu-west',
          url: 'https://grpc.eu.shyft.to',
          location: 'EU West',
          priority: 2,
          healthy: true,
          latency: 0,
          lastCheck: new Date(),
          failures: 0
        },
        {
          name: 'asia-pacific',
          url: 'https://grpc.ap.shyft.to',
          location: 'Asia Pacific',
          priority: 3,
          healthy: true,
          latency: 0,
          lastCheck: new Date(),
          failures: 0
        }
      ],
      healthCheckInterval: 30000, // 30 seconds
      latencyThreshold: 2000,     // 2 seconds
      maxFailures: 3,
      autoFailover: true,
      ...config
    };
    
    this.initialize();
  }

  static create(eventBus: EventBus, config?: Partial<RegionConfig>): MultiRegionManager {
    if (!MultiRegionManager.instance) {
      MultiRegionManager.instance = new MultiRegionManager(eventBus, config);
    }
    return MultiRegionManager.instance;
  }

  /**
   * Initialize the service
   */
  private async initialize(): Promise<void> {
    // Select initial region
    await this.selectBestRegion();
    
    // Start health checks
    this.startHealthChecks();
    
    // Setup event listeners
    this.setupEventListeners();
    
    this.logger.info('Multi-region manager initialized', {
      regions: this.config.regions.length,
      currentRegion: this.currentRegion?.name
    });
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for connection failures
    this.eventBus.on('stream:error', this.handleStreamError.bind(this));
    this.eventBus.on('stream:disconnected', this.handleDisconnection.bind(this));
    
    // Listen for performance metrics
    this.eventBus.on('request:complete', this.handleRequestComplete.bind(this));
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(
      () => this.performHealthChecks(),
      this.config.healthCheckInterval
    );
    
    // Perform initial health check
    this.performHealthChecks();
  }

  /**
   * Perform health checks on all regions
   */
  private async performHealthChecks(): Promise<void> {
    const healthPromises = this.config.regions.map(region => 
      this.checkRegionHealth(region)
    );
    
    const results = await Promise.allSettled(healthPromises);
    
    // Process results
    results.forEach((result, index) => {
      const region = this.config.regions[index];
      
      if (result.status === 'fulfilled') {
        const healthResult = result.value;
        this.updateRegionHealth(region, healthResult);
      } else {
        // Health check failed
        this.updateRegionHealth(region, {
          region: region.name,
          healthy: false,
          latency: Infinity,
          error: result.reason?.message || 'Health check failed',
          timestamp: new Date()
        });
      }
    });
    
    // Check if current region is still optimal
    await this.evaluateCurrentRegion();
  }

  /**
   * Check health of a specific region
   */
  private async checkRegionHealth(region: RegionEndpoint): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Simple HTTP health check
      // In production, this would check the actual gRPC endpoint
      const response = await axios.get(`${region.url}/health`, {
        timeout: 5000,
        validateStatus: () => true
      });
      
      const latency = Date.now() - startTime;
      const healthy = response.status === 200;
      
      return {
        region: region.name,
        healthy,
        latency,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        region: region.name,
        healthy: false,
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }

  /**
   * Update region health status
   */
  private updateRegionHealth(region: RegionEndpoint, result: HealthCheckResult): void {
    region.lastCheck = result.timestamp;
    region.latency = result.latency;
    
    if (result.healthy) {
      region.healthy = true;
      region.failures = 0;
    } else {
      region.failures++;
      if (region.failures >= this.config.maxFailures) {
        region.healthy = false;
        this.logger.warn('Region marked unhealthy', {
          region: region.name,
          failures: region.failures,
          error: result.error
        });
      }
    }
    
    // Update latency history
    if (!this.latencyHistory.has(region.name)) {
      this.latencyHistory.set(region.name, []);
    }
    
    const history = this.latencyHistory.get(region.name)!;
    history.push(result.latency);
    
    // Keep only recent history
    if (history.length > 100) {
      this.latencyHistory.set(region.name, history.slice(-100));
    }
  }

  /**
   * Select the best available region
   */
  async selectBestRegion(): Promise<RegionEndpoint | undefined> {
    // Filter healthy regions
    const healthyRegions = this.config.regions.filter(r => r.healthy);
    
    if (healthyRegions.length === 0) {
      this.logger.error('No healthy regions available!');
      return undefined;
    }
    
    // Sort by priority and latency
    healthyRegions.sort((a, b) => {
      // First by priority
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Then by latency
      return a.latency - b.latency;
    });
    
    const bestRegion = healthyRegions[0];
    
    if (this.currentRegion !== bestRegion) {
      await this.switchRegion(bestRegion, 'Better region available');
    }
    
    return bestRegion;
  }

  /**
   * Switch to a different region
   */
  private async switchRegion(
    newRegion: RegionEndpoint, 
    reason: string, 
    automatic: boolean = true
  ): Promise<void> {
    const oldRegion = this.currentRegion;
    
    this.logger.info('Switching region', {
      from: oldRegion?.name,
      to: newRegion.name,
      reason
    });
    
    // Update current region
    this.currentRegion = newRegion;
    
    // Record failover event
    if (oldRegion) {
      const failoverEvent: FailoverEvent = {
        fromRegion: oldRegion.name,
        toRegion: newRegion.name,
        reason,
        timestamp: new Date(),
        automatic
      };
      
      this.failoverHistory.push(failoverEvent);
      
      // Keep only recent history
      if (this.failoverHistory.length > 100) {
        this.failoverHistory = this.failoverHistory.slice(-100);
      }
      
      // Emit failover event
      this.eventBus.emit('region:failover', failoverEvent);
    }
    
    // Emit region change event
    this.eventBus.emit('region:changed', {
      region: newRegion.name,
      url: newRegion.url,
      location: newRegion.location
    });
  }

  /**
   * Evaluate if current region is still optimal
   */
  private async evaluateCurrentRegion(): Promise<void> {
    if (!this.currentRegion || !this.config.autoFailover) return;
    
    // Check if current region is unhealthy
    if (!this.currentRegion.healthy) {
      await this.handleFailover('Current region unhealthy');
      return;
    }
    
    // Check if current region has high latency
    if (this.currentRegion.latency > this.config.latencyThreshold) {
      // Find better region
      const betterRegion = this.config.regions.find(r => 
        r.healthy && 
        r.latency < this.currentRegion!.latency * 0.7 && // 30% better
        r.priority <= this.currentRegion!.priority
      );
      
      if (betterRegion) {
        await this.switchRegion(betterRegion, 'Lower latency region available');
      }
    }
  }

  /**
   * Handle stream error
   */
  private async handleStreamError(event: any): Promise<void> {
    if (!this.currentRegion) return;
    
    // Update stats
    const stats = this.getOrCreateRegionStats(this.currentRegion.name);
    stats.totalRequests++;
    
    this.logger.warn('Stream error in current region', {
      region: this.currentRegion.name,
      error: event.error
    });
    
    // Check if we should failover
    this.currentRegion.failures++;
    if (this.currentRegion.failures >= this.config.maxFailures) {
      await this.handleFailover('Stream errors exceeded threshold');
    }
  }

  /**
   * Handle disconnection
   */
  private async handleDisconnection(_event: any): Promise<void> {
    if (!this.currentRegion) return;
    
    this.logger.warn('Disconnection from current region', {
      region: this.currentRegion.name
    });
    
    // Attempt immediate failover
    await this.handleFailover('Disconnection detected');
  }

  /**
   * Handle request completion
   */
  private handleRequestComplete(event: any): void {
    if (!this.currentRegion || !event.region) return;
    
    const stats = this.getOrCreateRegionStats(event.region);
    stats.totalRequests++;
    
    if (event.success) {
      stats.successfulRequests++;
      stats.lastSuccess = new Date();
    }
    
    if (event.latency) {
      stats.totalLatency += event.latency;
    }
  }

  /**
   * Handle failover
   */
  private async handleFailover(reason: string): Promise<void> {
    if (!this.config.autoFailover) {
      this.logger.warn('Auto-failover disabled, manual intervention required');
      return;
    }
    
    this.logger.info('Initiating failover', { reason });
    
    // Mark current region as unhealthy
    if (this.currentRegion) {
      this.currentRegion.healthy = false;
    }
    
    // Select new region
    const newRegion = await this.selectBestRegion();
    
    if (!newRegion) {
      this.logger.error('Failover failed: No healthy regions available');
      this.eventBus.emit('region:all_unhealthy', {
        timestamp: new Date()
      });
    }
  }

  /**
   * Get or create region stats
   */
  private getOrCreateRegionStats(regionName: string) {
    if (!this.regionStats.has(regionName)) {
      this.regionStats.set(regionName, {
        totalRequests: 0,
        successfulRequests: 0,
        totalLatency: 0,
        lastSuccess: new Date()
      });
    }
    
    return this.regionStats.get(regionName)!;
  }

  /**
   * Get current endpoint
   */
  getCurrentEndpoint(): string | undefined {
    return this.currentRegion?.url;
  }

  /**
   * Get current region info
   */
  getCurrentRegion(): RegionEndpoint | undefined {
    return this.currentRegion;
  }

  /**
   * Get all regions status
   */
  getRegionsStatus(): RegionEndpoint[] {
    return this.config.regions;
  }

  /**
   * Get failover history
   */
  getFailoverHistory(): FailoverEvent[] {
    return [...this.failoverHistory];
  }

  /**
   * Get region statistics
   */
  getRegionStats(regionName?: string): any {
    if (regionName) {
      const stats = this.regionStats.get(regionName);
      const latencies = this.latencyHistory.get(regionName) || [];
      
      if (!stats) return null;
      
      return {
        ...stats,
        successRate: stats.totalRequests > 0 
          ? stats.successfulRequests / stats.totalRequests 
          : 0,
        averageLatency: stats.totalRequests > 0
          ? stats.totalLatency / stats.totalRequests
          : 0,
        recentLatencies: latencies.slice(-10),
        p95Latency: this.calculatePercentile(latencies, 0.95)
      };
    }
    
    // Return all regions stats
    const allStats: any = {};
    for (const region of this.config.regions) {
      allStats[region.name] = this.getRegionStats(region.name);
    }
    return allStats;
  }

  /**
   * Calculate percentile
   */
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[index] || 0;
  }

  /**
   * Manually switch region
   */
  async manualSwitchRegion(regionName: string): Promise<boolean> {
    const region = this.config.regions.find(r => r.name === regionName);
    
    if (!region) {
      this.logger.error('Region not found', { regionName });
      return false;
    }
    
    if (!region.healthy) {
      this.logger.warn('Switching to unhealthy region', { regionName });
    }
    
    await this.switchRegion(region, 'Manual switch', false);
    return true;
  }

  /**
   * Update region configuration
   */
  updateRegionConfig(regionName: string, config: Partial<RegionEndpoint>): void {
    const region = this.config.regions.find(r => r.name === regionName);
    
    if (region) {
      Object.assign(region, config);
      this.logger.info('Region config updated', { regionName, config });
    }
  }

  /**
   * Stop the service
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.logger.info('Multi-region manager stopped');
  }
}