#!/usr/bin/env tsx
/**
 * Demo: Refactored Monitoring System
 * Shows how to use the new clean architecture
 */

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from './src/core/container-factory';
import { BCMonitorRefactored } from './src/monitors/bc-monitor-refactored';
import { AMMMonitorRefactored } from './src/monitors/amm-monitor-refactored';
import { WebSocketServer } from './src/websocket/websocket-server';
import { EventBus, EVENTS } from './src/core/event-bus';
import { Container, TOKENS } from './src/core/container';
import { createServer } from 'http';
import express from 'express';
import path from 'path';

async function demo() {
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════╗
║        🚀 Refactored System Demo 🚀                  ║
║                                                       ║
║    Demonstrating the new clean architecture          ║
╚═══════════════════════════════════════════════════════╝
`));

  console.log(chalk.yellow('\n1. Creating Dependency Injection Container...'));
  const container = await createContainer();
  console.log(chalk.green('   ✓ Container created with all services'));

  // Get services from container
  const eventBus = await container.resolve(TOKENS.EventBus) as EventBus;
  const config = await container.resolve(TOKENS.ConfigService);
  
  console.log(chalk.yellow('\n2. Setting up Event Listeners...'));
  setupDemoEventListeners(eventBus);
  console.log(chalk.green('   ✓ Event listeners configured'));

  console.log(chalk.yellow('\n3. Creating Monitors with DI...'));
  const bcMonitor = new BCMonitorRefactored(container);
  const ammMonitor = new AMMMonitorRefactored(container);
  console.log(chalk.green('   ✓ Monitors created (no singletons!)'));

  console.log(chalk.yellow('\n4. Setting up API Server...'));
  const { app, server } = await setupApiServer(container, eventBus);
  console.log(chalk.green('   ✓ API server ready'));

  console.log(chalk.yellow('\n5. Creating WebSocket Server...'));
  const wsServer = new WebSocketServer(server, eventBus, config);
  wsServer.startPingInterval();
  console.log(chalk.green('   ✓ WebSocket server initialized'));

  console.log(chalk.yellow('\n6. Starting Monitors...'));
  // In real usage, monitors would connect to blockchain
  // For demo, we'll simulate some events
  console.log(chalk.green('   ✓ Monitors would connect to Shyft gRPC'));

  console.log(chalk.blue('\n📊 Demo Configuration:'));
  console.log(chalk.gray('   - BC Save Threshold: $' + config.get('monitors').bcSaveThreshold));
  console.log(chalk.gray('   - AMM Save Threshold: $' + config.get('monitors').ammSaveThreshold));
  console.log(chalk.gray('   - API Port: ' + config.get('api').port));
  console.log(chalk.gray('   - WebSocket Path: ' + config.get('api').webSocketPath));

  console.log(chalk.yellow('\n7. Simulating Events...'));
  await simulateEvents(eventBus);

  console.log(chalk.cyan('\n✨ Demo Complete! Key improvements:'));
  console.log(chalk.green('   ✓ No more singletons - everything uses DI'));
  console.log(chalk.green('   ✓ Event-driven architecture with EventBus'));
  console.log(chalk.green('   ✓ Clean separation of concerns'));
  console.log(chalk.green('   ✓ Unified services (no duplicates)'));
  console.log(chalk.green('   ✓ Proper WebSocket implementation'));
  console.log(chalk.green('   ✓ Repository pattern for data access'));
  console.log(chalk.green('   ✓ Strategy pattern for parsing'));
  console.log(chalk.green('   ✓ Base monitor abstraction'));

  console.log(chalk.yellow('\n📚 To run the full system:'));
  console.log(chalk.gray('   npm run start-refactored    # Start all monitors'));
  console.log(chalk.gray('   npm run server-refactored   # Start API server'));
  console.log(chalk.gray('   npm run test:integration    # Run integration tests'));

  // Cleanup
  setTimeout(() => {
    console.log(chalk.gray('\nShutting down demo...'));
    process.exit(0);
  }, 5000);
}

function setupDemoEventListeners(eventBus: EventBus) {
  // Token events
  eventBus.on(EVENTS.TOKEN_DISCOVERED, (token) => {
    console.log(chalk.magenta(`   📍 Token discovered: ${token.mintAddress.substring(0, 8)}...`));
  });

  eventBus.on(EVENTS.TOKEN_GRADUATED, (data) => {
    console.log(chalk.yellow(`   🎓 Token graduated: ${data.mintAddress.substring(0, 8)}...`));
  });

  eventBus.on(EVENTS.TOKEN_THRESHOLD_CROSSED, (data) => {
    console.log(chalk.green(`   💰 Threshold crossed: $${data.threshold}`));
  });

  // Trade events
  eventBus.on(EVENTS.BC_TRADE, (data) => {
    console.log(chalk.blue(`   📈 BC Trade: ${data.trade.type} - ${data.monitor}`));
  });

  eventBus.on(EVENTS.AMM_TRADE, (data) => {
    console.log(chalk.cyan(`   📊 AMM Trade: ${data.trade.type} - ${data.monitor}`));
  });

  // System events
  eventBus.on(EVENTS.MONITOR_ERROR, (data) => {
    console.log(chalk.red(`   ❌ Error in ${data.monitor}: ${data.error.message}`));
  });
}

async function setupApiServer(container: Container, eventBus: EventBus) {
  const app = express();
  
  // Simple demo endpoints
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      architecture: 'refactored',
      timestamp: new Date()
    });
  });

  app.get('/api/demo/container', (req, res) => {
    res.json({
      message: 'Container-based DI is working!',
      services: [
        'EventBus',
        'ConfigService',
        'Logger',
        'TokenRepository',
        'TradeRepository',
        'UnifiedEventParser',
        'TradeHandler'
      ]
    });
  });

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));

  const server = createServer(app);
  
  const port = 3458; // Demo port
  server.listen(port, () => {
    console.log(chalk.gray(`   Demo API: http://localhost:${port}/api/health`));
    console.log(chalk.gray(`   WebSocket: ws://localhost:${port}/ws`));
  });

  return { app, server };
}

async function simulateEvents(eventBus: EventBus) {
  // Simulate BC trade
  await delay(500);
  eventBus.emit(EVENTS.BC_TRADE, {
    trade: {
      signature: 'demo-bc-123',
      mintAddress: 'DemoToken11111111111111111111111111111111',
      type: 'buy',
      userAddress: 'DemoUser111111111111111111111111111111111',
      solAmount: 1000000000n,
      tokenAmount: 1000000n
    },
    monitor: 'BC Monitor Demo'
  });

  // Simulate token discovery
  await delay(300);
  eventBus.emit(EVENTS.TOKEN_DISCOVERED, {
    mintAddress: 'DemoToken11111111111111111111111111111111',
    symbol: 'DEMO',
    firstPriceUsd: 0.001,
    currentMarketCapUsd: 5000
  });

  // Simulate threshold crossing
  await delay(300);
  eventBus.emit(EVENTS.TOKEN_THRESHOLD_CROSSED, {
    mintAddress: 'DemoToken11111111111111111111111111111111',
    threshold: 1000,
    marketCapUsd: 1500
  });

  // Simulate graduation
  await delay(500);
  eventBus.emit(EVENTS.TOKEN_GRADUATED, {
    mintAddress: 'DemoToken11111111111111111111111111111111',
    graduationSlot: 123456789
  });

  // Simulate AMM trade
  await delay(300);
  eventBus.emit(EVENTS.AMM_TRADE, {
    trade: {
      signature: 'demo-amm-456',
      mintAddress: 'DemoToken11111111111111111111111111111111',
      type: 'sell',
      userAddress: 'DemoUser222222222222222222222222222222222',
      solAmount: 2000000000n,
      tokenAmount: 2000000n,
      poolAddress: 'DemoPool111111111111111111111111111111111'
    },
    monitor: 'AMM Monitor Demo'
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run demo
demo().catch(console.error);