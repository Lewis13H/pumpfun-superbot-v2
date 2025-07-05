import { Router } from 'express';
import { FaultToleranceController } from '../controllers/fault-tolerance-controller';

export function createFaultToleranceRoutes(controller: FaultToleranceController): Router {
  const router = Router();

  // Fault tolerance status
  router.get('/status', (req, res) => controller.getStatus(req, res));

  // Circuit breakers
  router.get('/circuit-breakers', (req, res) => controller.getCircuitBreakers(req, res));

  // Alerts
  router.get('/alerts', (req, res) => controller.getAlerts(req, res));
  router.delete('/alerts', (req, res) => controller.clearAlerts(req, res));

  return router;
}