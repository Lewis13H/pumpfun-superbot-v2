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
import { EnhancedStaleTokenDetector } from './services/enhanced-stale-token-detector';

// Set log level to ERROR for minimal output
Logger.setGlobalLevel(LogLevel.ERROR);

// Disable monitor stats display
process.env.DISABLE_MONITOR_STATS = 'true';

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
  staleTokens: number;
  tokensRecovered: number;
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
  activeMonitors: new Set(),
  staleTokens: 0,
  tokensRecovered: 0
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
  
  // Clear previous stats display (7 lines)
  moveCursor(7);
  
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
  
  // Third row: Stale detection stats
  console.log(
    chalk.yellow(`Stale: ${stats.staleTokens}`) + ' | ' +
    chalk.green(`Recovered: ${stats.tokensRecovered}`) + ' | ' +
    chalk.gray('Auto-removal: ON')
  );
  
  // Fourth row: Monitor status
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
    await container.resolve('ConfigService' as any) as ConfigService;
    
    // Pre-resolve shared services
    await container.resolve(TOKENS.StreamClient);
    await container.resolve(TOKENS.DatabaseService);
    await container.resolve(TOKENS.SolPriceService);
    await container.resolve(TOKENS.GraduationHandler);
    
    // Initialize metadata enricher
    await container.resolve(TOKENS.MetadataEnricher);
    logger.debug('Metadata enricher initialized and running');
    
    // Initialize StreamManager - this starts the shared stream
    await container.resolve(TOKENS.StreamManager);
    logger.debug('StreamManager initialized with shared gRPC connection');
    
    clearLine();
    process.stdout.write('Starting monitors...');
    
    // Setup event listeners before starting monitors
    setupEventListeners(eventBus, logger);
    
    // Create monitors based on environment settings
    const monitors = [];
    
    if (!process.env.DISABLE_BC_MONITORS) {
      monitors.push(new BCMonitor(container));
      monitors.push(new BCAccountMonitor(container));
    }
    
    monitors.push(new AMMMonitor(container));
    monitors.push(new AMMAccountMonitor(container));
    
    // Start all monitors
    // Since we're using StreamManager, we don't need staggered starts
    for (const monitor of monitors) {
      await monitor.start();
      stats.activeMonitors.add(monitor.constructor.name.replace('Monitor', ''));
    }
    
    // Start enhanced stale token detector
    const staleDetector = EnhancedStaleTokenDetector.getInstance({
      scanIntervalMinutes: 5,
      enableAutoRemoval: true,
      softDeleteOnly: true,
      enableDexScreenerFallback: true,
      enableDetailedLogging: false, // Reduce noise in production
      logStaleDetectionRuns: true
    });
    
    await staleDetector.start();
    stats.activeMonitors.add('StaleDetector');
    logger.debug('Enhanced stale token detector started');
    
    // Start graduation fixer service
    await container.resolve(TOKENS.GraduationFixerService);
    stats.activeMonitors.add('GraduationFixer');
    logger.debug('Graduation fixer service started');
    
    clearLine();
    console.log(chalk.green('✅ All systems operational\n'));
    
    // Initial stats display
    console.log('\n'.repeat(6)); // Make space for stats (increased for extra line)
    displayStats();
    
    // Update stats every 5 seconds
    setInterval(displayStats, 5000);
    
    // Update stale token stats periodically
    setInterval(() => {
      const detectorStats = staleDetector.getEnhancedStats();
      stats.staleTokens = detectorStats.staleTokensFound;
      stats.tokensRecovered = detectorStats.tokensRecovered;
    }, 10000); // Every 10 seconds
    
    // Setup graceful shutdown
    setupGracefulShutdown(monitors, logger, container);
    
  } catch (error) {
    logger.error('Failed to start system', error as Error);
    process.exit(1);
  }
}

/**
 * Setup event listeners for statistics
 */
function setupEventListeners(eventBus: EventBus, _logger: Logger) {
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
    // Handle both mintAddress and bondingCurveKey formats
    const identifier = data.mintAddress || data.bondingCurveKey || 'Unknown';
    const displayId = identifier.substring(0, 8) + '...';
    console.log(chalk.green(`\n🎓 GRADUATION: ${displayId} graduated to AMM!\n`));
  });
  
  // Graduation fix events
  eventBus.on(EVENTS.GRADUATION_FIXED, (data) => {
    stats.graduations++;
    const displayId = data.mintAddress.substring(0, 8) + '...';
    console.log(chalk.magenta(`\n🔧 GRADUATION FIXED: ${data.symbol} (${displayId}) marked as graduated\n`));
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
    if (data.marketCapUsd > 50000 && data.mintAddress) {
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
function setupGracefulShutdown(monitors: any[], logger: Logger, container?: any) {
  let isShuttingDown = false;
  
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(chalk.yellow('\n\n🛑 Shutting down gracefully...'));
    
    // Stop all monitors properly
    console.log(chalk.yellow('Stopping monitors and closing connections...'));
    for (const monitor of monitors) {
      try {
        if (monitor && typeof monitor.stop === 'function') {
          await monitor.stop();
        }
      } catch (error) {
        logger.error(`Error stopping ${monitor.constructor.name}`, error as Error);
      }
    }
    
    // Stop graduation fixer service
    if (container) {
      try {
        const graduationFixer = await container.resolve(TOKENS.GraduationFixerService);
        if (graduationFixer && typeof graduationFixer.shutdown === 'function') {
          await graduationFixer.shutdown();
          console.log(chalk.yellow('Graduation fixer service stopped'));
        }
      } catch (error) {
        logger.error('Error stopping graduation fixer', error as Error);
      }
    }
    
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
    
    // Handle Shyft connection limit error
    if (error.message?.includes('PERMISSION_DENIED') && error.message?.includes('Maximum connection count reached')) {
      console.error(chalk.red('\n❌ Shyft connection limit reached!'));
      console.error(chalk.yellow('\nThis happens when too many connections are active.'));
      console.error(chalk.yellow('Solutions:'));
      console.error(chalk.yellow('1. Wait 5-10 minutes for existing connections to timeout'));
      console.error(chalk.yellow('2. Run: ./scripts/fix-connection-limit.sh'));
      console.error(chalk.yellow('3. Use a different SHYFT_GRPC_TOKEN if available\n'));
      shutdown();
      return;
    }
    
    // Handle rate limit error
    if (error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('Max subscriptions')) {
      console.error(chalk.red('\n❌ Shyft rate limit hit!'));
      console.error(chalk.yellow('\nYou\'ve exceeded 100 subscriptions in 60 seconds.'));
      console.error(chalk.yellow('The system will automatically retry in 60 seconds.'));
      console.error(chalk.yellow('To prevent this:'));
      console.error(chalk.yellow('1. The monitors now start with 2-second delays between them'));
      console.error(chalk.yellow('2. Reconnection attempts are rate-limited'));
      console.error(chalk.yellow('3. Consider running fewer monitors if the issue persists\n'));
      // Don't shutdown, let the monitors retry with backoff
      return;
    }
    
    if (error.stack?.includes('ECONNRESET') || error.stack?.includes('EPIPE')) {
      console.log(chalk.yellow('Network error - system will continue running'));
    } else {
      shutdown();
    }
  });
  
  process.on('unhandledRejection', (reason, _promise) => {
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