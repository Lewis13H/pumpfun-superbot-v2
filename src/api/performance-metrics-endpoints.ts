import { Request, Response } from 'express';
import { performanceMonitor } from '../services/performance-monitor';
import { WebSocketServer, WebSocket } from 'ws';

// WebSocket connections for metrics streaming
const metricsClients = new Set<WebSocket>();

// Initialize performance metrics WebSocket - DISABLED
export function initPerformanceWebSocket(server: any) {
  // WebSocket disabled - performance metrics available via REST API
  console.log('Performance WebSocket disabled - use REST API for metrics');
}

// Broadcast to all connected metrics clients
function broadcastToMetricsClients(data: any) {
  const message = JSON.stringify(data);
  metricsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// API Endpoints

/**
 * GET /api/v1/performance/metrics
 * Get current performance metrics
 */
export async function getPerformanceMetrics(req: Request, res: Response) {
  try {
    const metrics = performanceMonitor.getCurrentMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('Error getting performance metrics:', error);
    res.status(500).json({ error: 'Failed to get performance metrics' });
  }
}

/**
 * GET /api/v1/performance/health
 * Get system health score
 */
export async function getHealthScore(req: Request, res: Response) {
  try {
    const health = performanceMonitor.getHealthScore();
    const status = health >= 80 ? 'healthy' : health >= 60 ? 'degraded' : 'unhealthy';
    
    res.json({
      score: health,
      status,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error getting health score:', error);
    res.status(500).json({ error: 'Failed to get health score' });
  }
}

/**
 * GET /api/v1/performance/errors
 * Get error logs with optional filtering
 */
export async function getErrorLogs(req: Request, res: Response) {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const component = req.query.component as string;
    const level = req.query.level as string;
    
    const errors = performanceMonitor.getErrorLogs(limit, {
      component,
      level
    });
    
    res.json(errors);
  } catch (error) {
    console.error('Error getting error logs:', error);
    res.status(500).json({ error: 'Failed to get error logs' });
  }
}

/**
 * DELETE /api/v1/performance/errors
 * Clear error logs
 */
export async function clearErrorLogs(req: Request, res: Response) {
  try {
    performanceMonitor.clearErrorLogs();
    res.json({ message: 'Error logs cleared successfully' });
  } catch (error) {
    console.error('Error clearing error logs:', error);
    res.status(500).json({ error: 'Failed to clear error logs' });
  }
}

/**
 * GET /api/v1/performance/recommendations
 * Get optimization recommendations
 */
export async function getOptimizationRecommendations(req: Request, res: Response) {
  try {
    const recommendations = performanceMonitor.getOptimizationRecommendations();
    res.json(recommendations);
  } catch (error) {
    console.error('Error getting recommendations:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
}

/**
 * GET /api/v1/performance/monitors/:name
 * Get detailed metrics for a specific monitor
 */
export async function getMonitorDetails(req: Request, res: Response) {
  try {
    const { name } = req.params;
    const metrics = performanceMonitor.getCurrentMetrics();
    
    const monitor = metrics.monitors.find(m => m.name === name);
    const stream = metrics.streams.find(s => s.name === name);
    
    if (!monitor) {
      return res.status(404).json({ error: 'Monitor not found' });
    }
    
    res.json({
      monitor,
      stream,
      health: monitor.status === 'healthy' ? 100 : 
             monitor.status === 'degraded' ? 75 :
             monitor.status === 'unhealthy' ? 50 : 0
    });
  } catch (error) {
    console.error('Error getting monitor details:', error);
    res.status(500).json({ error: 'Failed to get monitor details' });
  }
}

/**
 * POST /api/v1/performance/test-error
 * Generate a test error for debugging
 */
export async function generateTestError(req: Request, res: Response) {
  try {
    const { component = 'test', level = 'error', message = 'Test error message' } = req.body;
    
    const testError = new Error(message);
    performanceMonitor.recordError(component, testError, level as any);
    
    res.json({ message: 'Test error generated successfully' });
  } catch (error) {
    console.error('Error generating test error:', error);
    res.status(500).json({ error: 'Failed to generate test error' });
  }
}

// Export function to register all endpoints
export function registerPerformanceEndpoints(app: any) {
  // Performance metrics endpoints
  app.get('/api/v1/performance/metrics', getPerformanceMetrics);
  app.get('/api/v1/performance/health', getHealthScore);
  app.get('/api/v1/performance/errors', getErrorLogs);
  app.delete('/api/v1/performance/errors', clearErrorLogs);
  app.get('/api/v1/performance/recommendations', getOptimizationRecommendations);
  app.get('/api/v1/performance/monitors/:name', getMonitorDetails);
  app.post('/api/v1/performance/test-error', generateTestError);
}