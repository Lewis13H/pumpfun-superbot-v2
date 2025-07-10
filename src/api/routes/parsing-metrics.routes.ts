import { Router } from 'express';
import { ParsingMetricsService } from '../../services/monitoring/parsing-metrics-service';

export function createParsingMetricsRoutes(): Router {
  const router = Router();
  const metricsService = ParsingMetricsService.getInstance();
  
  // Overview metrics endpoint
  router.get('/api/parsing-metrics/overview', async (req, res) => {
    try {
      const overview = metricsService.getOverviewMetrics();
      const pumpBCMetrics = metricsService.getProgramMetrics('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
      const pumpAMMMetrics = metricsService.getProgramMetrics('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
      const raydiumMetrics = metricsService.getProgramMetrics('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
      
      res.json({
        success: true,
        data: {
          overall: {
            parseRate: overview.overallParseRate,
            totalTransactions: overview.totalTransactions,
            successfullyParsed: overview.successfullyParsed,
            avgParseTime: Math.round(overview.avgParseTime),
            tps: overview.tps.toFixed(1),
            failedCount: overview.failedCount
          },
          byProgram: {
            'pump.fun': {
              parseRate: pumpBCMetrics.parseRate,
              totalTransactions: pumpBCMetrics.totalTransactions,
              successfullyParsed: pumpBCMetrics.successfullyParsed,
              avgParseTime: Math.round(pumpBCMetrics.avgParseTime)
            },
            'pump.swap': {
              parseRate: pumpAMMMetrics.parseRate,
              totalTransactions: pumpAMMMetrics.totalTransactions,
              successfullyParsed: pumpAMMMetrics.successfullyParsed,
              avgParseTime: Math.round(pumpAMMMetrics.avgParseTime)
            },
            'raydium': {
              parseRate: raydiumMetrics.parseRate,
              totalTransactions: raydiumMetrics.totalTransactions,
              successfullyParsed: raydiumMetrics.successfullyParsed,
              avgParseTime: Math.round(raydiumMetrics.avgParseTime)
            }
          },
          recentFailures: metricsService.getRecentFailures(10)
        }
      });
    } catch (error) {
      console.error('Error fetching overview metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch overview metrics'
      });
    }
  });
  
  // Strategy metrics endpoint
  router.get('/api/parsing-metrics/strategies', async (req, res) => {
    try {
      const strategies = metricsService.getStrategyMetrics();
      
      res.json({
        success: true,
        data: strategies.map(s => ({
          name: s.strategy,
          successRate: s.successRate,
          attempts: s.attempts,
          avgParseTime: Math.round(s.avgParseTime),
          topErrors: s.topErrors.slice(0, 5)
        }))
      });
    } catch (error) {
      console.error('Error fetching strategy metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch strategy metrics'
      });
    }
  });
  
  // Data quality metrics endpoint
  router.get('/api/parsing-metrics/data-quality', async (req, res) => {
    try {
      res.json({
        success: true,
        data: {
          ammTradesWithReserves: metricsService.getReserveDataQuality(),
          reserveDataSources: metricsService.getReserveDataSources(),
          crossVenueCorrelation: metricsService.getCrossVenueMetrics(),
          marketCapAccuracy: metricsService.getMarketCapAccuracy()
        }
      });
    } catch (error) {
      console.error('Error fetching data quality metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch data quality metrics'
      });
    }
  });
  
  // System metrics endpoint
  router.get('/api/parsing-metrics/system', async (req, res) => {
    try {
      res.json({
        success: true,
        data: {
          parseQueueDepth: metricsService.getQueueDepth(),
          memoryUsage: process.memoryUsage(),
          eventBusMessagesPerSec: metricsService.getEventBusRate(),
          dbWriteThroughput: metricsService.getDbWriteRate()
        }
      });
    } catch (error) {
      console.error('Error fetching system metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch system metrics'
      });
    }
  });
  
  // Alerts endpoint
  router.get('/api/parsing-metrics/alerts', async (req, res) => {
    try {
      const alerts = metricsService.checkAlertThresholds();
      
      res.json({
        success: true,
        data: alerts
      });
    } catch (error) {
      console.error('Error fetching alerts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch alerts'
      });
    }
  });
  
  // Real-time failures WebSocket endpoint would be handled separately
  // For now, we'll use polling with the recent failures endpoint
  
  return router;
}