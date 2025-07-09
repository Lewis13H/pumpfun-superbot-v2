import { Router } from 'express';
import { Pool } from 'pg';
import { HolderAnalysisHistoricalController } from './holder-analysis-historical-controller';

export function createHolderAnalysisHistoricalRoutes(pool: Pool): Router {
  const router = Router();
  const controller = new HolderAnalysisHistoricalController(pool);

  // Historical data endpoints
  router.get('/holder-analysis/:mintAddress/history', 
    controller.getHolderHistory.bind(controller)
  );
  
  router.get('/holder-analysis/:mintAddress/trends', 
    controller.getTrends.bind(controller)
  );
  
  router.get('/holder-analysis/:mintAddress/comparison', 
    controller.compareToken.bind(controller)
  );
  
  router.get('/holder-analysis/:mintAddress/report', 
    controller.generateReport.bind(controller)
  );

  // Alert endpoints
  router.get('/holder-analysis/alerts', 
    controller.getAlerts.bind(controller)
  );
  
  router.post('/holder-analysis/alerts/:alertId/acknowledge', 
    controller.acknowledgeAlert.bind(controller)
  );
  
  router.get('/holder-analysis/:mintAddress/alerts/history', 
    controller.getAlertHistory.bind(controller)
  );

  // Leaderboard endpoint
  router.get('/holder-analysis/leaderboard', 
    controller.getLeaderboard.bind(controller)
  );

  return router;
}