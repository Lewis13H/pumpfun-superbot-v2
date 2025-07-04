/**
 * Test Raydium monitor in isolation
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from './core/container-factory';
import { RaydiumMonitor } from './monitors/raydium-monitor';
import { Logger, LogLevel } from './core/logger';
import { TOKENS } from './core/container';

// Enable debug logging
Logger.setGlobalLevel(LogLevel.DEBUG);

async function testRaydiumMonitor() {
  const logger = new Logger({ context: 'TestRaydium', color: chalk.magenta });
  
  try {
    console.log(chalk.blue('Starting Raydium Monitor test...'));
    
    // Create DI container
    const container = await createContainer();
    
    // Pre-resolve shared services
    await container.resolve(TOKENS.StreamClient);
    await container.resolve(TOKENS.DatabaseService);
    await container.resolve(TOKENS.SolPriceService);
    await container.resolve(TOKENS.GraduationHandler);
    await container.resolve(TOKENS.MetadataEnricher);
    
    // Initialize StreamManager - this starts the shared stream
    await container.resolve(TOKENS.StreamManager);
    logger.info('StreamManager initialized');
    
    // Create and start Raydium monitor
    const raydiumMonitor = new RaydiumMonitor(container);
    await raydiumMonitor.start();
    
    logger.info('Raydium monitor started successfully');
    
    // Display stats every 10 seconds
    setInterval(() => {
      console.log(chalk.yellow('\n=== Raydium Monitor Stats ==='));
      raydiumMonitor.displayStats();
    }, 10000);
    
    // Run for 2 minutes
    setTimeout(() => {
      console.log(chalk.yellow('\nStopping test...'));
      process.exit(0);
    }, 120000);
    
  } catch (error) {
    logger.error('Failed to start Raydium monitor', error as Error);
    process.exit(1);
  }
}

testRaydiumMonitor().catch(console.error);