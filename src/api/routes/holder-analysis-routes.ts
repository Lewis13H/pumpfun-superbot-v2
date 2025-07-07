/**
 * Holder Analysis API Routes
 */

import { Router } from 'express';
import { Pool } from 'pg';
import { HolderAnalysisApiController } from '../controllers/holder-analysis-api-controller';

export function createHolderAnalysisRoutes(pool: Pool): Router {
  const router = Router();
  const controller = new HolderAnalysisApiController(
    pool,
    process.env.HELIUS_API_KEY,
    process.env.SHYFT_API_KEY
  );

  // Token analysis endpoints
  router.get('/holder-analysis/:mintAddress', (req, res) => controller.getTokenAnalysis(req, res));
  router.post('/holder-analysis/batch', (req, res) => controller.getBatchAnalysis(req, res));
  router.post('/holder-analysis/analyze', (req, res) => controller.queueAnalysis(req, res));

  // Job management endpoints
  router.get('/holder-analysis/jobs', (req, res) => controller.getJobs(req, res));
  router.get('/holder-analysis/jobs/:jobId', (req, res) => controller.getJob(req, res));
  router.delete('/holder-analysis/jobs/:jobId', (req, res) => controller.cancelJob(req, res));

  // Schedule endpoints
  router.get('/holder-analysis/schedules', (req, res) => controller.getSchedules(req, res));

  // Metrics and analytics
  router.get('/holder-analysis/metrics', (req, res) => controller.getMetrics(req, res));
  router.get('/holder-analysis/top-tokens', (req, res) => controller.getTopTokens(req, res));
  router.get('/holder-analysis/distribution/:mintAddress', (req, res) => controller.getDistribution(req, res));

  return router;
}