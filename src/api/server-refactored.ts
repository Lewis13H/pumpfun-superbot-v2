/**
 * Refactored API Server
 * Uses the new WebSocket implementation and clean architecture
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer } from 'http';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { WebSocketServer } from '../websocket/websocket-server';
import { EventBus } from '../core/event-bus';
import { ConfigService } from '../core/config';
import { Logger } from '../core/logger';
import { TokenRepository } from '../repositories/token-repository';
import { TradeRepository } from '../repositories/trade-repository';
import { TOKENS } from '../core/container';

/**
 * Create and configure Express app
 */
async function createApp() {
  const app = express();
  const logger = new Logger({ context: 'API', color: chalk.blue });
  
  // Create container
  const container = await createContainer();
  const config = await container.resolve(TOKENS.ConfigService) as ConfigService;
  const eventBus = await container.resolve(TOKENS.EventBus) as EventBus;
  const tokenRepo = await container.resolve(TOKENS.TokenRepository) as TokenRepository;
  const tradeRepo = await container.resolve(TOKENS.TradeRepository) as TradeRepository;
  
  // Middleware
  app.use(cors({
    origin: config.get('api').corsOrigins,
    credentials: true
  }));
  app.use(express.json());
  
  // API Routes
  
  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date(),
      uptime: process.uptime()
    });
  });
  
  // Token endpoints
  app.get('/api/tokens', async (req, res) => {
    try {
      const { limit = 100, offset = 0, graduated, minMarketCap } = req.query;
      
      const tokens = await tokenRepo.findByFilter({
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        graduatedToAmm: graduated === 'true' ? true : graduated === 'false' ? false : undefined,
        marketCapUsdGte: minMarketCap ? parseFloat(minMarketCap as string) : undefined
      });
      
      res.json(tokens);
    } catch (error) {
      logger.error('Failed to fetch tokens', error as Error);
      res.status(500).json({ error: 'Failed to fetch tokens' });
    }
  });
  
  app.get('/api/tokens/:mintAddress', async (req, res) => {
    try {
      const token = await tokenRepo.findByMintAddress(req.params.mintAddress);
      if (!token) {
        return res.status(404).json({ error: 'Token not found' });
      }
      res.json(token);
    } catch (error) {
      logger.error('Failed to fetch token', error as Error);
      res.status(500).json({ error: 'Failed to fetch token' });
    }
  });
  
  app.get('/api/tokens/:mintAddress/trades', async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      const trades = await tradeRepo.getTradesForToken(
        req.params.mintAddress,
        parseInt(limit as string)
      );
      res.json(trades);
    } catch (error) {
      logger.error('Failed to fetch trades', error as Error);
      res.status(500).json({ error: 'Failed to fetch trades' });
    }
  });
  
  // Trade endpoints
  app.get('/api/trades/recent', async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      const trades = await tradeRepo.getRecentTrades(parseInt(limit as string));
      res.json(trades);
    } catch (error) {
      logger.error('Failed to fetch recent trades', error as Error);
      res.status(500).json({ error: 'Failed to fetch recent trades' });
    }
  });
  
  app.get('/api/trades/high-value', async (req, res) => {
    try {
      const { minVolume = 10000, limit = 100 } = req.query;
      const trades = await tradeRepo.getHighValueTrades(
        parseFloat(minVolume as string),
        parseInt(limit as string)
      );
      res.json(trades);
    } catch (error) {
      logger.error('Failed to fetch high value trades', error as Error);
      res.status(500).json({ error: 'Failed to fetch high value trades' });
    }
  });
  
  // Statistics endpoints
  app.get('/api/stats/overview', async (req, res) => {
    try {
      const tokenStats = await tokenRepo.getStatistics();
      const topTraders = await tradeRepo.getTopTraders(10);
      
      res.json({
        tokens: tokenStats,
        topTraders
      });
    } catch (error) {
      logger.error('Failed to fetch statistics', error as Error);
      res.status(500).json({ error: 'Failed to fetch statistics' });
    }
  });
  
  app.get('/api/stats/volume/:period', async (req, res) => {
    try {
      const { period } = req.params;
      const now = new Date();
      const startTime = new Date(now.getTime() - (period === 'day' ? 86400000 : 3600000));
      
      const volume = await tradeRepo.getVolumeByPeriod(
        startTime,
        now,
        period === 'day' ? 'hour' : 'hour'
      );
      
      res.json(volume);
    } catch (error) {
      logger.error('Failed to fetch volume data', error as Error);
      res.status(500).json({ error: 'Failed to fetch volume data' });
    }
  });
  
  // Static files
  app.use(express.static(path.join(__dirname, '../../public')));
  
  // Dashboard routes
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });
  
  app.get('/bc-monitor', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/bc-monitor.html'));
  });
  
  app.get('/amm-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/amm-dashboard.html'));
  });
  
  return { app, container, config, eventBus, logger };
}

/**
 * Start the server
 */
async function startServer() {
  const { app, container, config, eventBus, logger } = await createApp();
  
  // Create HTTP server
  const httpServer = createServer(app);
  
  // Create WebSocket server if enabled
  let wsServer: WebSocketServer | null = null;
  if (config.get('api').enableWebSocket) {
    logger.info('Initializing WebSocket server...');
    wsServer = new WebSocketServer(httpServer, eventBus, config);
    wsServer.startPingInterval();
    logger.info('WebSocket server initialized');
  }
  
  // Start listening
  const port = config.get('api').port;
  httpServer.listen(port, () => {
    logger.info(`API server listening on port ${port}`);
    logger.info(`Dashboard: http://localhost:${port}`);
    if (wsServer) {
      logger.info(`WebSocket: ws://localhost:${port}${config.get('api').webSocketPath}`);
    }
  });
  
  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down API server...');
    
    if (wsServer) {
      await wsServer.shutdown();
    }
    
    httpServer.close(() => {
      logger.info('API server closed');
      process.exit(0);
    });
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Display banner
console.log(chalk.blue(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║           🌐 Pump.fun API Server v2.0 🌐             ║
║                                                       ║
║              With Real-time WebSocket                 ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`));

// Start server
startServer().catch(console.error);