/**
 * Start Wrapped Monitors - Production Ready
 * Optimized for long-running sessions with clean display and stats
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from './core/container-factory';
import { BCMonitor } from './monitors/bc-monitor';
import { BCAccountMonitor } from './monitors/bc-account-monitor';
import { AMMMonitor } from './monitors/amm-monitor';
import { AMMAccountMonitor } from './monitors/amm-account-monitor';
import { EventBus, EVENTS } from './core/event-bus';
import { Logger, LogLevel } from './core/logger';
import { ConfigService } from './core/config';
import { TOKENS } from './core/container';

// Set log level to INFO for cleaner output
Logger.setGlobalLevel(LogLevel.INFO);

// Statistics tracking
interface SystemStats {
  startTime: Date;
  bcTrades: number;
  ammTrades: number;
  totalVolume: number;
  tokensDiscovered: number;
  tokensEnriched: number;
  graduations: number;
  errors: number;
  lastError: string | null;
  lastErrorTime: Date | null;
  solPrice: number;
  activeMonitors: Set<string>;
}

const stats: SystemStats = {
  startTime: new Date(),
  bcTrades: 0,
  ammTrades: 0,
  totalVolume: 0,
  tokensDiscovered: 0,
  tokensEnriched: 0,
  graduations: 0,
  errors: 0,
  lastError: null,
  lastErrorTime: null,
  solPrice: 0,
  activeMonitors: new Set()
};

// Terminal utilities
const clearLine = () => process.stdout.write('\r\x1b[K');
const moveCursor = (lines: number) => process.stdout.write(`\x1b[${lines}A`);

/**
 * Display live statistics dashboard
 */
function displayStats() {
  const runtime = Math.floor((Date.now() - stats.startTime.getTime()) / 1000);
  const hours = Math.floor(runtime / 3600);
  const minutes = Math.floor((runtime % 3600) / 60);
  const seconds = runtime % 60;
  const runtimeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  
  // Clear previous stats display (6 lines)
  moveCursor(6);
  
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.cyan('📊 System Statistics') + chalk.gray(` | Runtime: ${runtimeStr} | SOL: $${stats.solPrice.toFixed(2)}`));
  console.log(chalk.gray('─'.repeat(60)));
  
  // First row: Trade stats
  console.log(
    chalk.green(`BC Trades: ${stats.bcTrades.toLocaleString()}`) + ' | ' +
    chalk.blue(`AMM Trades: ${stats.ammTrades.toLocaleString()}`) + ' | ' +
    chalk.yellow(`Volume: $${Math.floor(stats.totalVolume).toLocaleString()}`)
  );
  
  // Second row: Token stats
  console.log(
    chalk.magenta(`Tokens: ${stats.tokensDiscovered}`) + ' | ' +
    chalk.cyan(`Enriched: ${stats.tokensEnriched}`) + ' | ' +
    chalk.green(`Graduated: ${stats.graduations}`) + ' | ' +
    chalk.red(`Errors: ${stats.errors}`)
  );
  
  // Third row: Monitor status
  const monitorStatus = Array.from(stats.activeMonitors).map(m => 
    chalk.green('●') + ' ' + m
  ).join(' | ');
  console.log(chalk.gray('Monitors: ') + monitorStatus);
}

/**
 * Start all monitors
 */
async function startMonitors() {
  const logger = new Logger({ context: 'System', color: chalk.cyan });
  
  try {
    // Silent initialization
    process.stdout.write('Initializing system...');
    
    // Create DI container
    const container = await createContainer();
    
    // Get core services
    const eventBus = await container.resolve('EventBus' as any) as EventBus;
    const config = await container.resolve('ConfigService' as any) as ConfigService;
    
    // Pre-resolve shared services
    await container.resolve(TOKENS.StreamClient);
    await container.resolve(TOKENS.DatabaseService);
    await container.resolve(TOKENS.SolPriceService);
    await container.resolve(TOKENS.GraduationHandler);
    
    clearLine();
    process.stdout.write('Starting monitors...');
    
    // Setup event listeners before starting monitors
    setupEventListeners(eventBus, logger);
    
    // Create monitors
    const monitors = [
      new BCMonitor(container),
      new BCAccountMonitor(container),
      new AMMMonitor(container),
      new AMMAccountMonitor(container)
    ];
    
    // Start all monitors
    for (const monitor of monitors) {
      await monitor.start();
      stats.activeMonitors.add(monitor.constructor.name.replace('Monitor', ''));
    }
    
    clearLine();
    console.log(chalk.green('✅ All systems operational\n'));
    
    // Initial stats display
    console.log('\n'.repeat(5)); // Make space for stats
    displayStats();
    
    // Update stats every 5 seconds
    setInterval(displayStats, 5000);
    
    // Setup graceful shutdown
    setupGracefulShutdown(monitors, logger);
    
  } catch (error) {
    logger.error('Failed to start system', error as Error);
    process.exit(1);
  }
}

/**
 * Setup event listeners for statistics
 */
function setupEventListeners(eventBus: EventBus, logger: Logger) {
  // Trade events
  eventBus.on(EVENTS.BC_TRADE, (data) => {
    stats.bcTrades++;
    stats.totalVolume += data.trade.volumeUsd || 0;
  });
  
  eventBus.on(EVENTS.AMM_TRADE, (data) => {
    stats.ammTrades++;
    stats.totalVolume += data.trade.volumeUsd || 0;
  });
  
  // Token events
  eventBus.on(EVENTS.TOKEN_DISCOVERED, (token) => {
    stats.tokensDiscovered++;
    
    // Only log high-value discoveries
    if (token.currentMarketCapUsd > 100000) {
      console.log(chalk.yellow(`\n💎 High-value token: ${token.symbol || 'UNKNOWN'} - $${token.currentMarketCapUsd.toLocaleString()}\n`));
    }
  });
  
  eventBus.on(EVENTS.TOKEN_METADATA_UPDATED, () => {
    stats.tokensEnriched++;
  });
  
  // Graduation events
  eventBus.on(EVENTS.TOKEN_GRADUATED, (data) => {
    stats.graduations++;
    console.log(chalk.green(`\n🎓 GRADUATION: ${data.mintAddress.substring(0, 8)}... graduated to AMM!\n`));
  });
  
  // Error handling
  eventBus.on(EVENTS.MONITOR_ERROR, (data) => {
    stats.errors++;
    stats.lastError = `${data.monitor}: ${data.error.message}`;
    stats.lastErrorTime = new Date();
    
    // Only log critical errors
    if (data.error.message?.includes('connection') || 
        data.error.message?.includes('ENOTFOUND') ||
        data.error.message?.includes('timeout')) {
      console.log(chalk.red(`\n❌ Critical error in ${data.monitor}: ${data.error.message}\n`));
    }
  });
  
  // SOL price updates
  eventBus.on(EVENTS.SOL_PRICE_UPDATED, (price) => {
    stats.solPrice = price;
  });
  
  // Threshold crossings
  eventBus.on(EVENTS.TOKEN_THRESHOLD_CROSSED, (data) => {
    if (data.marketCapUsd > 50000) {
      console.log(chalk.magenta(`\n💰 Threshold crossed: ${data.mintAddress.substring(0, 8)}... - $${data.marketCapUsd.toLocaleString()}\n`));
    }
  });
  
  // Log summary every 10 minutes
  setInterval(() => {
    const runtime = Math.floor((Date.now() - stats.startTime.getTime()) / 60);
    console.log(chalk.cyan(`\n📈 ${runtime}min Summary:`));
    console.log(chalk.gray(`   Total trades: ${(stats.bcTrades + stats.ammTrades).toLocaleString()}`));
    console.log(chalk.gray(`   Avg trades/min: ${Math.floor((stats.bcTrades + stats.ammTrades) / runtime)}`));
    console.log(chalk.gray(`   Total volume: $${Math.floor(stats.totalVolume).toLocaleString()}`));
    console.log(chalk.gray(`   Tokens/hour: ${Math.floor(stats.tokensDiscovered / runtime * 60)}`));
    if (stats.lastError) {
      console.log(chalk.red(`   Last error: ${stats.lastError} (${Math.floor((Date.now() - stats.lastErrorTime!.getTime()) / 60000)}min ago)`));
    }
    console.log('');
  }, 600000); // 10 minutes
}

/**
 * Setup graceful shutdown
 */
function setupGracefulShutdown(monitors: any[], logger: Logger) {
  let isShuttingDown = false;
  
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(chalk.yellow('\n\n🛑 Shutting down gracefully...'));
    
    // Print final stats
    const runtime = Math.floor((Date.now() - stats.startTime.getTime()) / 60);
    console.log(chalk.cyan('\n📊 Final Statistics:'));
    console.log(chalk.gray(`   Runtime: ${runtime} minutes`));
    console.log(chalk.gray(`   Total trades: ${(stats.bcTrades + stats.ammTrades).toLocaleString()}`));
    console.log(chalk.gray(`   Total volume: $${Math.floor(stats.totalVolume).toLocaleString()}`));
    console.log(chalk.gray(`   Tokens discovered: ${stats.tokensDiscovered}`));
    console.log(chalk.gray(`   Graduations: ${stats.graduations}`));
    console.log(chalk.gray(`   Errors: ${stats.errors}`));
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    stats.errors++;
    console.error(chalk.red('\n⚠️  Uncaught exception:'), error.message);
    if (error.stack?.includes('ECONNRESET') || error.stack?.includes('EPIPE')) {
      console.log(chalk.yellow('Network error - system will continue running'));
    } else {
      shutdown();
    }
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    stats.errors++;
    console.error(chalk.red('\n⚠️  Unhandled rejection:'), reason);
    // Don't shutdown on rejections - just log them
  });
}

/**
 * Display startup banner
 */
function displayBanner() {
  console.clear();
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║        🚀 Pump.fun Monitor System v2.0 🚀            ║
║                                                       ║
║          Production Mode - Long Running               ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`));
}

// Main entry point
displayBanner();
startMonitors().catch(console.error);