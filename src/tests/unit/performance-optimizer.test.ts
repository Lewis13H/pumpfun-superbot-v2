import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerformanceOptimizer } from '../../services/optimization/performance-optimizer';
import { EventBus } from '../../core/event-bus';

describe('PerformanceOptimizer', () => {
  let optimizer: PerformanceOptimizer;
  let eventBus: EventBus;
  let config: any;

  beforeEach(() => {
    eventBus = new EventBus();
    
    config = {
      optimizationInterval: 100, // Short for testing
      metricsInterval: 50,
      thresholds: {
        throughput: { min: 10, max: 100 },
        latency: { warning: 500, critical: 1000 },
        errorRate: { warning: 0.05, critical: 0.1 }
      },
      adjustments: {
        batchSize: { min: 10, max: 100, step: 10 },
        cacheSize: { min: 100, max: 10000, step: 100 },
        cacheTTL: { min: 1000, max: 60000, step: 1000 }
      }
    };

    optimizer = new PerformanceOptimizer(eventBus, config);
  });

  afterEach(() => {
    optimizer.stop();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should start optimization and metrics intervals', async () => {
      optimizer.start();
      
      // Wait for intervals to fire
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const report = optimizer.getPerformanceReport();
      expect(report).toBeDefined();
      expect(report.metrics).toBeDefined();
      expect(report.optimizations).toBeDefined();
    });
  });

  describe('metrics collection', () => {
    it('should collect throughput metrics', () => {
      optimizer.start();

      // Simulate messages
      for (let i = 0; i < 50; i++) {
        eventBus.emit('message:processed', {});
      }

      const report = optimizer.getPerformanceReport();
      expect(report.metrics.throughput.current).toBeGreaterThan(0);
    });

    it('should track latency metrics', () => {
      optimizer.start();

      // Simulate various latencies
      eventBus.emit('operation:complete', { duration: 100 });
      eventBus.emit('operation:complete', { duration: 200 });
      eventBus.emit('operation:complete', { duration: 150 });

      const report = optimizer.getPerformanceReport();
      expect(report.metrics.latency.average).toBeCloseTo(150, 1);
      expect(report.metrics.latency.p95).toBeDefined();
      expect(report.metrics.latency.p99).toBeDefined();
    });

    it('should track error rates', () => {
      optimizer.start();

      // Simulate successes and errors
      for (let i = 0; i < 95; i++) {
        eventBus.emit('operation:success', {});
      }
      for (let i = 0; i < 5; i++) {
        eventBus.emit('operation:error', {});
      }

      const report = optimizer.getPerformanceReport();
      expect(report.metrics.errorRate.current).toBeCloseTo(0.05, 2);
    });

    it('should track resource usage', () => {
      optimizer.start();

      // Simulate resource metrics
      eventBus.emit('resource:update', {
        cpu: 45.5,
        memory: { used: 500, total: 1000 },
        connections: 5
      });

      const report = optimizer.getPerformanceReport();
      expect(report.metrics.resources.cpu).toBe(45.5);
      expect(report.metrics.resources.memoryUsage).toBe(50);
      expect(report.metrics.resources.activeConnections).toBe(5);
    });
  });

  describe('optimization decisions', () => {
    beforeEach(() => {
      optimizer.start();
    });

    it('should increase batch size on high throughput', async () => {
      const adjustmentSpy = vi.fn();
      eventBus.on('optimization:adjustment', adjustmentSpy);

      // Simulate high throughput
      for (let i = 0; i < 200; i++) {
        eventBus.emit('message:processed', {});
      }

      // Wait for optimization cycle
      await new Promise(resolve => setTimeout(resolve, config.optimizationInterval + 50));

      expect(adjustmentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          parameter: 'batchSize',
          direction: 'increase'
        })
      );
    });

    it('should decrease batch size on high latency', async () => {
      const adjustmentSpy = vi.fn();
      eventBus.on('optimization:adjustment', adjustmentSpy);

      // Simulate high latency
      for (let i = 0; i < 10; i++) {
        eventBus.emit('operation:complete', { duration: 1200 });
      }

      // Wait for optimization cycle
      await new Promise(resolve => setTimeout(resolve, config.optimizationInterval + 50));

      expect(adjustmentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          parameter: 'batchSize',
          direction: 'decrease'
        })
      );
    });

    it('should adjust cache TTL based on hit rate', async () => {
      const adjustmentSpy = vi.fn();
      eventBus.on('optimization:adjustment', adjustmentSpy);

      // Simulate good cache hit rate
      eventBus.emit('cache:stats', {
        hits: 80,
        misses: 20,
        evictions: 5
      });

      // Wait for optimization cycle
      await new Promise(resolve => setTimeout(resolve, config.optimizationInterval + 50));

      expect(adjustmentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          parameter: 'cacheTTL',
          direction: 'increase'
        })
      );
    });

    it('should optimize resource allocation', async () => {
      const adjustmentSpy = vi.fn();
      eventBus.on('optimization:adjustment', adjustmentSpy);

      // Simulate high CPU usage
      eventBus.emit('resource:update', {
        cpu: 85,
        memory: { used: 800, total: 1000 },
        connections: 10
      });

      // Wait for optimization cycle
      await new Promise(resolve => setTimeout(resolve, config.optimizationInterval + 50));

      // Should suggest reducing resource usage
      const calls = adjustmentSpy.mock.calls;
      expect(calls.some(call => call[0].parameter === 'connections')).toBe(true);
    });
  });

  describe('adaptive thresholds', () => {
    it('should adjust thresholds based on historical data', async () => {
      optimizer.start();

      // Simulate consistent performance
      for (let i = 0; i < 100; i++) {
        eventBus.emit('message:processed', {});
        eventBus.emit('operation:complete', { duration: 50 });
      }

      // Wait for multiple optimization cycles
      await new Promise(resolve => setTimeout(resolve, config.optimizationInterval * 3));

      const report = optimizer.getPerformanceReport();
      expect(report.optimizations.adaptiveThresholds).toBeDefined();
    });
  });

  describe('performance alerts', () => {
    it('should emit alerts on critical conditions', () => {
      const alertSpy = vi.fn();
      eventBus.on('optimization:alert', alertSpy);

      optimizer.start();

      // Simulate critical error rate
      for (let i = 0; i < 20; i++) {
        eventBus.emit('operation:error', {});
      }
      for (let i = 0; i < 80; i++) {
        eventBus.emit('operation:success', {});
      }

      // Alert should be emitted
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'critical',
          metric: 'errorRate'
        })
      );
    });

    it('should emit improvement notifications', async () => {
      const improvementSpy = vi.fn();
      eventBus.on('optimization:improvement', improvementSpy);

      optimizer.start();

      // Simulate improving performance
      for (let i = 0; i < 50; i++) {
        eventBus.emit('message:processed', {});
        eventBus.emit('operation:complete', { duration: 50 });
      }

      await new Promise(resolve => setTimeout(resolve, config.optimizationInterval + 50));

      // Simulate even better performance
      for (let i = 0; i < 100; i++) {
        eventBus.emit('message:processed', {});
        eventBus.emit('operation:complete', { duration: 25 });
      }

      await new Promise(resolve => setTimeout(resolve, config.optimizationInterval + 50));

      expect(improvementSpy).toHaveBeenCalled();
    });
  });

  describe('optimization history', () => {
    it('should track optimization decisions', async () => {
      optimizer.start();

      // Trigger some optimizations
      for (let i = 0; i < 200; i++) {
        eventBus.emit('message:processed', {});
      }

      await new Promise(resolve => setTimeout(resolve, config.optimizationInterval + 50));

      const report = optimizer.getPerformanceReport();
      expect(report.optimizations.history).toBeDefined();
      expect(report.optimizations.history.length).toBeGreaterThan(0);
      
      const lastOptimization = report.optimizations.history[0];
      expect(lastOptimization).toHaveProperty('timestamp');
      expect(lastOptimization).toHaveProperty('adjustments');
      expect(lastOptimization).toHaveProperty('reason');
    });
  });

  describe('performance report', () => {
    it('should generate comprehensive report', () => {
      optimizer.start();

      // Generate some activity
      for (let i = 0; i < 50; i++) {
        eventBus.emit('message:processed', {});
        eventBus.emit('operation:complete', { duration: Math.random() * 200 });
      }

      const report = optimizer.getPerformanceReport();

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('metrics');
      expect(report).toHaveProperty('optimizations');
      expect(report).toHaveProperty('recommendations');

      expect(report.metrics).toHaveProperty('throughput');
      expect(report.metrics).toHaveProperty('latency');
      expect(report.metrics).toHaveProperty('errorRate');
      expect(report.metrics).toHaveProperty('resources');

      expect(report.recommendations).toBeInstanceOf(Array);
    });
  });

  describe('stop functionality', () => {
    it('should stop all intervals on stop', async () => {
      optimizer.start();

      const metricsEmitSpy = vi.fn();
      eventBus.on('performance:metrics', metricsEmitSpy);

      optimizer.stop();

      // Wait longer than intervals
      await new Promise(resolve => setTimeout(resolve, config.optimizationInterval * 2));

      // Should not emit any more metrics
      expect(metricsEmitSpy).not.toHaveBeenCalled();
    });

    it('should emit final report on stop', () => {
      const finalReportSpy = vi.fn();
      eventBus.on('optimization:final-report', finalReportSpy);

      optimizer.start();
      optimizer.stop();

      expect(finalReportSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Date),
          metrics: expect.any(Object),
          optimizations: expect.any(Object)
        })
      );
    });
  });
});