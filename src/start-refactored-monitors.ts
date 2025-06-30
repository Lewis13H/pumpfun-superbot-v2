/**
 * Start Refactored Monitors
 * Demonstrates the new architecture with all monitors running together
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from './core/container-factory';
import { BCMonitorRefactored } from './monitors/bc-monitor-refactored';
import { AMMMonitorRefactored } from './monitors/amm-monitor-refactored';
import { EventBus, EVENTS } from './core/event-bus';
import { Logger, LogLevel } from './core/logger';
import { ConfigService } from './core/config';

// Set log level based on environment
Logger.setGlobalLevel(
  process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG
);

/**
 * Start all monitors
 */
async function startMonitors() {
  const logger = new Logger({ context: 'Main', color: chalk.cyan });
  
  try {
    logger.info('Initializing container and services...');
    
    // Create DI container
    const container = await createContainer();
    
    // Get core services
    const eventBus = await container.resolve('EventBus' as any) as EventBus;
    const config = await container.resolve('ConfigService' as any) as ConfigService;
    
    // Log configuration
    if (config.isDevelopment()) {
      config.logConfig();
    }
    
    // Setup global event listeners
    setupGlobalEventListeners(eventBus, logger);
    
    // Create monitors
    logger.info('Creating monitors...');
    const monitors = [
      new BCMonitorRefactored(container),
      new AMMMonitorRefactored(container)
    ];
    
    // Start all monitors
    logger.info('Starting all monitors...');
    await Promise.all(monitors.map(monitor => monitor.start()));
    
    logger.info('All monitors started successfully! 🚀');
    
    // Setup graceful shutdown
    setupGracefulShutdown(monitors, logger);
    
  } catch (error) {
    logger.error('Failed to start monitors', error as Error);
    process.exit(1);
  }
}

/**
 * Setup global event listeners
 */
function setupGlobalEventListeners(eventBus: EventBus, logger: Logger) {
  // Token discovery
  let tokensDiscovered = 0;
  eventBus.on(EVENTS.TOKEN_DISCOVERED, (token) => {
    tokensDiscovered++;
    logger.info(`🎯 Token #${tokensDiscovered} discovered!`, {
      mint: token.mintAddress.substring(0, 12) + '...',
      marketCap: `$${(token.currentMarketCapUsd || 0).toLocaleString()}`
    });
  });
  
  // Graduations
  eventBus.on(EVENTS.TOKEN_GRADUATED, (data) => {
    logger.warn('🎓 TOKEN GRADUATED TO AMM!', {
      mint: data.mintAddress,
      slot: data.graduationSlot
    });
  });
  
  // Threshold crossings
  eventBus.on(EVENTS.TOKEN_THRESHOLD_CROSSED, (data) => {
    logger.warn(`💰 Token crossed $${data.threshold} threshold!`, {
      mint: data.mintAddress.substring(0, 12) + '...',
      marketCap: `$${data.marketCapUsd.toLocaleString()}`
    });
  });
  
  // Monitor errors
  eventBus.on(EVENTS.MONITOR_ERROR, (data) => {
    logger.error(`Monitor error in ${data.monitor}`, data.error);
  });
  
  // Price updates
  let lastSolPrice = 0;
  eventBus.on(EVENTS.SOL_PRICE_UPDATED, (price) => {
    if (Math.abs(price - lastSolPrice) > 1) {
      logger.info(`SOL price updated: $${price.toFixed(2)}`);
      lastSolPrice = price;
    }
  });
  
  // Statistics aggregation
  const stats = {
    bcTrades: 0,
    ammTrades: 0,
    totalVolume: 0
  };
  
  eventBus.on(EVENTS.BC_TRADE, (data) => {
    stats.bcTrades++;
    stats.totalVolume += data.trade.volumeUsd || 0;
  });
  
  eventBus.on(EVENTS.AMM_TRADE, (data) => {
    stats.ammTrades++;
    stats.totalVolume += data.trade.volumeUsd || 0;
  });
  
  // Display aggregate stats every minute
  setInterval(() => {
    logger.info('📊 Aggregate Statistics', {
      bcTrades: stats.bcTrades,
      ammTrades: stats.ammTrades,
      totalVolume: `$${stats.totalVolume.toLocaleString()}`,
      tokensDiscovered
    });
  }, 60000);
}

/**
 * Setup graceful shutdown
 */
function setupGracefulShutdown(monitors: any[], logger: Logger) {
  let isShuttingDown = false;
  
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info('\n🛑 Initiating graceful shutdown...');
    
    // The monitors will handle their own shutdown through BaseMonitor
    // Just wait a moment for them to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    logger.info('Shutdown complete. Goodbye! 👋');
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception!', error);
    shutdown();
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', reason as Error);
    shutdown();
  });
}

/**
 * Display startup banner
 */
function displayBanner() {
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║        🚀 Pump.fun Monitor System v2.0 🚀            ║
║                                                       ║
║        Refactored with Clean Architecture            ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`));
}

// Main entry point
displayBanner();
startMonitors().catch(console.error);