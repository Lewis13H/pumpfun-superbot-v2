/**
 * Run Raydium Monitor Standalone
 * For testing and debugging Raydium AMM monitoring
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from './core/container-factory';
import { RaydiumMonitor } from './monitors/raydium-monitor';
import { EventBus, EVENTS } from './core/event-bus';
import { Logger, LogLevel } from './core/logger';
import { TOKENS } from './core/container';

// Set log level
Logger.setGlobalLevel(LogLevel.INFO);

async function main() {
  const logger = new Logger({ context: 'RaydiumRunner', color: chalk.blue });
  
  try {
    console.log(chalk.blue(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║        🌊 Raydium AMM Monitor - Standalone 🌊        ║
║                                                       ║
║      Monitoring graduated pump.fun tokens             ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`));

    logger.info('Initializing container...');
    const container = await createContainer();
    
    // Get event bus for monitoring
    const eventBus = await container.resolve('EventBus' as any) as EventBus;
    
    // Pre-resolve required services
    logger.info('Initializing services...');
    await container.resolve(TOKENS.StreamClient);
    await container.resolve(TOKENS.DatabaseService);
    await container.resolve(TOKENS.SolPriceService);
    await container.resolve(TOKENS.MetadataEnricher);
    await container.resolve(TOKENS.StreamManager);
    
    // Setup event listeners
    setupEventListeners(eventBus, logger);
    
    // Create and start monitor
    logger.info('Starting Raydium monitor...');
    const monitor = new RaydiumMonitor(container);
    await monitor.start();
    
    logger.info(chalk.green('✅ Raydium monitor running'));
    console.log(chalk.gray('\nPress Ctrl+C to stop\n'));
    
    // Display stats every 30 seconds
    setInterval(() => {
      monitor.displayStats();
    }, 30000);
    
    // Setup graceful shutdown
    setupGracefulShutdown(monitor, logger);
    
  } catch (error) {
    logger.error('Failed to start Raydium monitor', error as Error);
    process.exit(1);
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners(eventBus: EventBus, logger: Logger) {
  // Raydium swap events
  eventBus.on(EVENTS.RAYDIUM_SWAP, (data) => {
    logger.info(chalk.green('🔄 Raydium swap detected'), {
      mintAddress: data.mintAddress?.slice(0, 8) + '...',
      type: data.tradeType,
      volume: `$${data.volumeUsd?.toFixed(2) || '0'}`
    });
  });
  
  // Liquidity events
  eventBus.on(EVENTS.RAYDIUM_LIQUIDITY, (data) => {
    logger.info(chalk.blue('💧 Raydium liquidity event'), {
      type: data.type,
      poolAddress: data.poolAddress?.slice(0, 8) + '...'
    });
  });
  
  // Graduated token found
  eventBus.on(EVENTS.GRADUATED_TOKEN_FOUND, (data) => {
    logger.info(chalk.magenta('🎓 Graduated token detected on Raydium!'), {
      mintAddress: data.mintAddress?.slice(0, 8) + '...',
      marketCap: `$${data.marketCapUsd?.toLocaleString() || '0'}`
    });
  });
  
  // Errors
  eventBus.on(EVENTS.MONITOR_ERROR, (data) => {
    if (data.monitor === 'RaydiumMonitor') {
      logger.error('Monitor error', data.error);
    }
  });
}

/**
 * Setup graceful shutdown
 */
function setupGracefulShutdown(monitor: RaydiumMonitor, logger: Logger) {
  let isShuttingDown = false;
  
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info('Shutting down gracefully...');
    
    try {
      await monitor.stop();
      logger.info('Monitor stopped');
    } catch (error) {
      logger.error('Error stopping monitor', error as Error);
    }
    
    // Display final stats
    monitor.displayStats();
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    shutdown();
  });
  
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason as Error);
  });
}

// Run the monitor
main().catch(console.error);