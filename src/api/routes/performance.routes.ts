import { Router } from 'express';
import { PerformanceOptimizationController } from '../controllers/performance-optimization-controller';

export function createPerformanceRoutes(controller: PerformanceOptimizationController): Router {
  const router = Router();

  // Optimization status
  router.get('/optimization-status', (req, res) => controller.getOptimizationStatus(req, res));

  // Batch metrics
  router.get('/batch/metrics', (req, res) => controller.getBatchMetrics(req, res));

  // Cache stats
  router.get('/cache/stats', (req, res) => controller.getCacheStats(req, res));

  // Resource metrics
  router.get('/resources', (req, res) => controller.getResourceMetrics(req, res));

  // Optimization suggestions
  router.get('/suggestions', (req, res) => controller.getSuggestions(req, res));

  // SSE streaming endpoint
  router.get('/stream', (req, res) => controller.setupSSE(req, res));

  // Memory cleanup endpoint
  router.post('/cleanup-memory', (req, res) => controller.cleanupMemory(req, res));

  return router;
}