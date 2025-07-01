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
import { LpTokenMonitor } from './monitors/lp-token-monitor';
import { EventBus, EVENTS } from './core/event-bus';
import { Logger, LogLevel } from './core/logger';
import { ConfigService } from './core/config';
import { TOKENS } from './core/container';

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
  liquidityDeposits: number;
  liquidityWithdrawals: number;
  totalLiquidityUsd: number;
  feesCollected: number;
  totalFeesUsd: number;
  lpPositions: number;
  lpPositionValueUsd: number;
  poolsAnalyzed: number;
  highApyPools: number;
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
  liquidityDeposits: 0,
  liquidityWithdrawals: 0,
  totalLiquidityUsd: 0,
  feesCollected: 0,
  totalFeesUsd: 0,
  lpPositions: 0,
  lpPositionValueUsd: 0,
  poolsAnalyzed: 0,
  highApyPools: 0,
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
  
  // Clear previous stats display (8 lines)
  moveCursor(8);
  
  console.log(chalk.gray('─'.repeat(70)));
  console.log(chalk.cyan('📊 System Statistics') + chalk.gray(` | Runtime: ${runtimeStr} | SOL: $${stats.solPrice.toFixed(2)}`));
  console.log(chalk.gray('─'.repeat(70)));
  
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
  
  // Third row: Liquidity stats
  console.log(
    chalk.blue(`Deposits: ${stats.liquidityDeposits}`) + ' | ' +
    chalk.yellow(`Withdrawals: ${stats.liquidityWithdrawals}`) + ' | ' +
    chalk.cyan(`Net Liquidity: $${Math.floor(stats.totalLiquidityUsd).toLocaleString()}`)
  );
  
  // Fourth row: Fee stats and LP positions
  console.log(
    chalk.magenta(`Fees Collected: ${stats.feesCollected}`) + ' | ' +
    chalk.green(`Total Fees: $${Math.floor(stats.totalFeesUsd).toLocaleString()}`) + ' | ' +
    chalk.cyan(`LP Positions: ${stats.lpPositions}`)
  );
  
  // Fifth row: Monitor status
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
    await container.resolve(TOKENS.LiquidityEventHandler);
    await container.resolve(TOKENS.FeeEventHandler);
    await container.resolve(TOKENS.LpPositionHandler);
    await container.resolve(TOKENS.PoolAnalyticsHandler);
    
    // Initialize StreamManager - this starts the shared stream
    await container.resolve(TOKENS.StreamManager);
    logger.debug('StreamManager initialized with shared gRPC connection');
    
    clearLine();
    process.stdout.write('Starting monitors...');
    
    // Setup event listeners before starting monitors
    setupEventListeners(eventBus, logger);
    
    // Create monitors
    const monitors = [
      new BCMonitor(container),
      new BCAccountMonitor(container),
      new AMMMonitor(container),
      new AMMAccountMonitor(container),
      new LpTokenMonitor(container)
    ];
    
    // Start all monitors
    // Since we're using StreamManager, we don't need staggered starts
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
  
  // Liquidity events
  eventBus.on(EVENTS.LIQUIDITY_PROCESSED, (data) => {
    if (data.type === 'deposit') {
      stats.liquidityDeposits++;
      stats.totalLiquidityUsd += data.valueUsd;
      
      // Log significant deposits
      if (data.valueUsd > 10000) {
        console.log(chalk.blue(`\n💧 Large deposit: $${data.valueUsd.toLocaleString()} to ${data.mint.substring(0, 8)}...\n`));
      }
    } else {
      stats.liquidityWithdrawals++;
      stats.totalLiquidityUsd -= data.valueUsd;
      
      // Log significant withdrawals
      if (data.valueUsd > 10000) {
        console.log(chalk.yellow(`\n💸 Large withdrawal: $${data.valueUsd.toLocaleString()} from ${data.mint.substring(0, 8)}...\n`));
      }
    }
  });
  
  // Fee events
  eventBus.on(EVENTS.FEE_PROCESSED, (data) => {
    stats.feesCollected++;
    // Fee value calculation would need to be done in the handler
    // For now, just track the count
    
    // Log significant fees
    if (data.coinAmount && Number(data.coinAmount) > 1e9) { // > 1 SOL
      console.log(chalk.magenta(`\n💰 Fee collected: ${data.feeType} fee from ${data.poolAddress.substring(0, 8)}...\n`));
    }
  });
  
  // LP position events
  eventBus.on(EVENTS.LP_POSITION_PROCESSED, (data) => {
    stats.lpPositions++;
    stats.lpPositionValueUsd = data.totalValueUsd;
    
    // Log significant positions
    if (data.totalValueUsd > 50000) {
      console.log(chalk.cyan(`\n🏊 Large LP position: $${data.totalValueUsd.toLocaleString()} (${data.sharePercentage.toFixed(2)}% of pool)\n`));
    }
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
  
  // Pool analytics events
  eventBus.on('POOL_ANALYTICS_UPDATED' as any, (data: any) => {
    stats.poolsAnalyzed++;
    if (data.metrics?.fees?.apy > 100) {
      stats.highApyPools++;
    }
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
function setupGracefulShutdown(monitors: any[], logger: Logger) {
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