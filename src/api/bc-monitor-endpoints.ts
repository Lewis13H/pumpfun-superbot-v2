import { Router } from 'express';
import { bcMonitorStats } from '../services/monitoring/bc-monitor-stats-aggregator';

const router = Router();

/**
 * Get current BC monitor statistics
 */
router.get('/stats', (_req, res) => {
  try {
    const stats = bcMonitorStats.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching BC monitor stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

/**
 * Get recent trading activity
 */
router.get('/trades', (_req, res) => {
  try {
    const activity = bcMonitorStats.getRecentActivity();
    res.json(activity.trades);
  } catch (error) {
    console.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

/**
 * Get recent graduations
 */
router.get('/graduations', (_req, res) => {
  try {
    const activity = bcMonitorStats.getRecentActivity();
    res.json(activity.graduations);
  } catch (error) {
    console.error('Error fetching graduations:', error);
    res.status(500).json({ error: 'Failed to fetch graduations' });
  }
});

/**
 * Get newly detected tokens
 */
router.get('/new-tokens', (_req, res) => {
  try {
    const activity = bcMonitorStats.getRecentActivity();
    res.json(activity.newTokens);
  } catch (error) {
    console.error('Error fetching new tokens:', error);
    res.status(500).json({ error: 'Failed to fetch new tokens' });
  }
});

/**
 * Get recent errors
 */
router.get('/errors', (_req, res) => {
  try {
    const activity = bcMonitorStats.getRecentActivity();
    res.json(activity.errors);
  } catch (error) {
    console.error('Error fetching errors:', error);
    res.status(500).json({ error: 'Failed to fetch errors' });
  }
});

/**
 * Get performance metrics and graphs
 */
router.get('/performance', (_req, res) => {
  try {
    const performance = bcMonitorStats.calculatePerformanceMetrics();
    const graphs = {
      transactionsPerSecond: bcMonitorStats.getStatHistory('transactionsPerSecond'),
      tradesPerMinute: bcMonitorStats.getStatHistory('tradesPerMinute'),
      parseSuccessRate: bcMonitorStats.getStatHistory('parseSuccessRate'),
      queueSize: bcMonitorStats.getStatHistory('queueSize'),
      memoryUsage: bcMonitorStats.getStatHistory('memoryUsageMB')
    };
    
    res.json({ performance, graphs });
  } catch (error) {
    console.error('Error fetching performance data:', error);
    res.status(500).json({ error: 'Failed to fetch performance data' });
  }
});

/**
 * Get complete dashboard summary
 */
router.get('/dashboard', (_req, res) => {
  try {
    const summary = bcMonitorStats.getDashboardSummary();
    res.json(summary);
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

export default router;