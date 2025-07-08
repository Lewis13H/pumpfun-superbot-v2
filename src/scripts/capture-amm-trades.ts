import 'dotenv/config';
import { createContainer } from '../core/container-factory';
import { TOKENS, Container } from '../core/container';
import { EventBus, EVENTS } from '../core/event-bus';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import { AMM_PROGRAM_ID } from '../utils/config/constants';
import chalk from 'chalk';

async function captureAMMTrades() {
  console.log(chalk.blue('🔍 Capturing AMM Trades to Debug Reserves...'));
  console.log(chalk.gray('📊 Will capture AMM transactions for 20 seconds'));
  console.log(chalk.gray('🎯 Looking for reserve information in transaction data\n'));

  // Create container
  const container = await createContainer();
  const eventBus = await container.resolve<EventBus>(TOKENS.EventBus);
  
  // Initialize required services
  await container.resolve(TOKENS.StreamClient);
  await container.resolve(TOKENS.DatabaseService);
  await container.resolve(TOKENS.SolPriceService);
  await container.resolve(TOKENS.StreamManager);
  
  let transactionCount = 0;
  const capturedTrades: any[] = [];
  
  // Listen for AMM trades
  eventBus.on(EVENTS.AMM_TRADE_DETECTED, (data: any) => {
    transactionCount++;
    
    console.log(chalk.yellow(`\n${'='.repeat(80)}`));
    console.log(chalk.yellow(`📦 AMM Trade #${transactionCount}`));
    console.log(chalk.yellow(`${'='.repeat(80)}`));
    
    // Log the full trade data
    console.log(chalk.cyan('\n📊 Trade Data:'));
    console.log(`  Type: ${data.type}`);
    console.log(`  Signature: ${data.signature}`);
    console.log(`  Mint: ${data.mint}`);
    console.log(`  Trader: ${data.trader}`);
    console.log(`  Pool: ${data.pool || 'N/A'}`);
    
    console.log(chalk.cyan('\n💰 Amounts:'));
    console.log(`  SOL Amount: ${data.solAmount} (${data.solAmount / 1e9} SOL)`);
    console.log(`  Token Amount: ${data.tokenAmount}`);
    
    if (data.price) {
      console.log(chalk.cyan('\n💲 Price Information:'));
      console.log(`  Price in SOL: ${data.price}`);
      console.log(`  Price in USD: ${data.priceUsd || 'N/A'}`);
    }
    
    if (data.virtualSolReserves !== undefined || data.virtualTokenReserves !== undefined) {
      console.log(chalk.green('\n🎯 RESERVES FOUND!'));
      console.log(`  Virtual SOL Reserves: ${data.virtualSolReserves}`);
      console.log(`  Virtual Token Reserves: ${data.virtualTokenReserves}`);
    } else {
      console.log(chalk.red('\n❌ No reserve data in trade event'));
    }
    
    // Store for analysis
    capturedTrades.push(data);
    
    // Log raw data if available
    if (data.raw) {
      console.log(chalk.gray('\n🔍 Raw Transaction Data Available (not shown for brevity)'));
    }
  });
  
  // Also listen for raw transaction data
  eventBus.on(EVENTS.TRANSACTION_PARSED, (data: any) => {
    if (data.programId === AMM_PROGRAM_ID && data.type === 'amm_trade') {
      console.log(chalk.magenta('\n📋 Raw AMM Transaction Parsed:'));
      console.log(`  Has Inner Instructions: ${data.innerInstructions ? 'Yes' : 'No'}`);
      console.log(`  Has Balance Changes: ${data.balanceChanges ? 'Yes' : 'No'}`);
      
      if (data.innerInstructions) {
        console.log(`  Inner Instruction Count: ${data.innerInstructions.length}`);
      }
    }
  });
  
  // Start the trading monitor
  console.log(chalk.green('✅ Starting Trading Activity Monitor...\n'));
  const monitor = new TradingActivityMonitor(container as any);
  await monitor.start();
  
  // Run for 20 seconds
  await new Promise(resolve => setTimeout(resolve, 20000));
  
  // Stop monitor
  await monitor.stop();
  
  // Summary
  console.log(chalk.blue(`\n${'='.repeat(80)}`));
  console.log(chalk.blue('📊 Capture Summary:'));
  console.log(chalk.blue(`${'='.repeat(80)}`));
  console.log(`Total AMM trades captured: ${transactionCount}`);
  
  if (capturedTrades.length > 0) {
    const tradesWithReserves = capturedTrades.filter(t => 
      t.virtualSolReserves !== undefined || t.virtualTokenReserves !== undefined
    );
    
    console.log(`\nTrades with reserve data: ${tradesWithReserves.length}`);
    console.log(`Trades without reserve data: ${capturedTrades.length - tradesWithReserves.length}`);
    
    console.log(chalk.yellow('\n💡 Analysis:'));
    if (tradesWithReserves.length === 0) {
      console.log('  ❌ No trades contained reserve information');
      console.log('  📍 Reserve data is likely stored in AMM pool account state');
      console.log('  📍 Need to fetch pool account data separately');
      console.log('  📍 Transaction data only contains trade amounts, not pool state');
    } else {
      console.log('  ✅ Some trades contained reserve information!');
      console.log('  📍 This suggests reserves are sometimes available');
      console.log('  📍 May depend on the specific transaction type');
    }
    
    // Show trade price calculation method
    console.log(chalk.cyan('\n💲 Price Calculation:'));
    console.log('  Current: Using trade amounts (SOL/Token ratio)');
    console.log('  Ideal: Using pool reserves for more accurate pricing');
    console.log('  Fallback: Trade amounts when reserves unavailable');
  }
  
  process.exit(0);
}

captureAMMTrades().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});