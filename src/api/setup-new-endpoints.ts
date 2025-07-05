import { Express } from 'express';
import { FaultToleranceController } from './controllers/fault-tolerance-controller';
import { PerformanceOptimizationController } from './controllers/performance-optimization-controller';
import { createFaultToleranceRoutes } from './routes/fault-tolerance.routes';
import { createPerformanceRoutes } from './routes/performance.routes';
import { createContainer } from '../core/container-factory';
import { FaultTolerantManager } from '../services/recovery/fault-tolerant-manager';
import { StateRecoveryService } from '../services/recovery/state-recovery-service';
import { FaultToleranceAlerts } from '../services/monitoring/fault-tolerance-alerts';
import { PerformanceOptimizer } from '../services/optimization/performance-optimizer';
import { DynamicBatchProcessor } from '../services/optimization/dynamic-batch-processor';
import { AdaptiveCacheManager } from '../services/optimization/adaptive-cache-manager';
import { PerformanceMonitor } from '../services/optimization/performance-monitor';
import { EventBus } from '../core/event-bus';

export async function setupNewEndpoints(app: Express): Promise<void> {
  try {
    // Get services from DI container or create instances
    const container = await createContainer();
    const eventBus = await container.resolve('EventBus' as any) as EventBus;
    
    // Get or create fault tolerance services
    let faultTolerantManager: FaultTolerantManager;
    let stateRecoveryService: StateRecoveryService;
    let alertService: FaultToleranceAlerts;
    
    try {
      faultTolerantManager = await container.resolve('FaultTolerantManager' as any) as FaultTolerantManager;
      stateRecoveryService = await container.resolve('StateRecoveryService' as any) as StateRecoveryService;
      alertService = await container.resolve('FaultToleranceAlerts' as any) as FaultToleranceAlerts;
    } catch (error) {
      console.log('Fault tolerance services not found in container, creating stubs');
      // Create stub implementations if services don't exist
      faultTolerantManager = {
        getHealthSummary: () => ({ healthy: 0, degraded: 0, failed: 0 }),
        getConnectionHealth: () => new Map()
      } as any;
      
      stateRecoveryService = {
        getLatestCheckpoint: async () => null
      } as any;
      
      alertService = {
        getAlertHistory: (_limit: number) => []
      } as any;
    }
    
    // Get or create performance services
    let performanceOptimizer: PerformanceOptimizer;
    let batchProcessor: DynamicBatchProcessor;
    let cacheManager: AdaptiveCacheManager;
    let performanceMonitor: PerformanceMonitor;
    
    try {
      performanceOptimizer = await container.resolve('PerformanceOptimizer' as any) as PerformanceOptimizer;
      batchProcessor = await container.resolve('DynamicBatchProcessor' as any) as DynamicBatchProcessor;
      cacheManager = await container.resolve('AdaptiveCacheManager' as any) as AdaptiveCacheManager;
      performanceMonitor = await container.resolve('PerformanceMonitor' as any) as PerformanceMonitor;
    } catch (error) {
      console.log('Performance services not found in container, creating stubs');
      // Create stub implementations if services don't exist
      performanceOptimizer = {
        getOptimizationParams: () => ({
          batchSize: 50,
          batchTimeout: 1000,
          cacheTTLMultiplier: 1,
          maxConcurrentOps: 10
        }),
        getPerformanceReport: () => ({
          improvement: { overall: 0 },
          metrics: {
            avgBatchSize: 50,
            throughput: 0,
            cacheHitRate: 0,
            cpuUsage: 0,
            memoryUsage: 0
          }
        }),
        getResourceAllocation: () => ({})
      } as any;
      
      batchProcessor = {
        getStats: () => ({
          currentBatchSize: 50,
          avgBatchSize: 50,
          minBatchSize: 10,
          maxBatchSize: 100,
          throughput: 0,
          avgLatency: 0
        }),
        getQueueInfo: () => ({
          totalSize: 0,
          priorityCounts: { high: 0, medium: 0, low: 0 }
        })
      } as any;
      
      cacheManager = {
        getStats: () => ({
          hitRate: 0,
          evictions: 0,
          compressionRatio: 1,
          size: 0,
          entries: 0,
          avgTTL: 300000
        }),
        getEntries: () => new Map()
      } as any;
      
      performanceMonitor = {
        getResourceMetrics: () => ({
          cpu: { usage: 0, cores: 1, loadAverage: [0, 0, 0] },
          memory: { used: 0, total: 0, percentage: 0, heapUsed: 0, heapTotal: 0 }
        })
      } as any;
    }
    
    // Create controllers
    const faultToleranceController = new FaultToleranceController(
      faultTolerantManager,
      stateRecoveryService,
      alertService
    );
    
    const performanceController = new PerformanceOptimizationController(
      performanceOptimizer,
      batchProcessor,
      cacheManager,
      performanceMonitor,
      eventBus
    );
    
    // Register routes
    app.use('/api/v1/fault-tolerance', createFaultToleranceRoutes(faultToleranceController));
    app.use('/api/v1/performance', createPerformanceRoutes(performanceController));
    
    console.log('✅ New API endpoints registered successfully');
    console.log('   - Fault tolerance endpoints: /api/v1/fault-tolerance/*');
    console.log('   - Performance endpoints: /api/v1/performance/*');
    
  } catch (error) {
    console.error('Error setting up new endpoints:', error);
    // Don't throw - allow server to start even if setup fails
  }
}