#!/usr/bin/env node

/**
 * Debug AMM monitoring to see what's happening
 */

import { Container } from '../core/container';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import chalk from 'chalk';

async function debugAMMMonitoring() {
  console.log(chalk.cyan('🔍 Debugging AMM Monitoring\n'));
  
  const container = new Container();
  
  try {
    // Check the trading monitor's stats
    const tradingMonitor = new TradingActivityMonitor(container);
    
    // Get the programs it's monitoring
    const programs = (tradingMonitor as any).PROGRAMS;
    console.log(chalk.yellow('1. Programs configured:'));
    console.log('  BC:', programs.BC);
    console.log('  AMM:', programs.AMM);
    console.log('  RAYDIUM:', programs.RAYDIUM);
    
    // Check if the AMM program ID is correct
    console.log(chalk.yellow('\n2. Verifying AMM Program ID:'));
    const expectedAMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
    const isCorrect = programs.AMM === expectedAMM;
    console.log(`  Expected: ${expectedAMM}`);
    console.log(`  Actual:   ${programs.AMM}`);
    console.log(`  Match:    ${isCorrect ? chalk.green('YES') : chalk.red('NO')}`);
    
    // Check if processTransaction method would handle AMM
    console.log(chalk.yellow('\n3. Testing transaction routing logic:'));
    
    // Simulate an AMM transaction
    const mockAMMData = {
      transaction: {
        transaction: {
          transaction: {
            message: {
              accountKeys: [
                'UserWallet11111111111111111111111111111111',
                expectedAMM, // AMM program
                'TokenMint11111111111111111111111111111111'
              ]
            }
          }
        }
      }
    };
    
    // Test if it would be recognized as relevant
    const isRelevant = (tradingMonitor as any).isRelevantTransaction(mockAMMData);
    console.log(`  Would process AMM transaction: ${isRelevant ? chalk.green('YES') : chalk.red('NO')}`);
    
    // Check the stats object
    console.log(chalk.yellow('\n4. Monitor stats structure:'));
    const stats = (tradingMonitor as any).stats;
    console.log('  Has ammTrades counter:', 'ammTrades' in stats ? chalk.green('YES') : chalk.red('NO'));
    console.log('  Stats keys:', Object.keys(stats).join(', '));
    
    // Check if we're looking for the right log patterns
    console.log(chalk.yellow('\n5. AMM Trade Detection:'));
    console.log('  The monitor looks for AMM program in account keys');
    console.log('  Then passes to UnifiedEventParser');
    console.log('  AMMTradeStrategy looks for these log signatures:');
    console.log('    - "Instruction: Swap"');
    console.log('    - "ray_log: "');
    console.log('    - "SwapBaseIn"');
    console.log('    - "SwapBaseOut"');
    
    // Recommendations
    console.log(chalk.cyan('\n📊 Recommendations:'));
    console.log('1. The monitor configuration looks correct');
    console.log('2. The subscription should include AMM after restart');
    console.log('3. Possible issues:');
    console.log('   - Monitors not restarted after code changes');
    console.log('   - AMM trades using different log signatures');
    console.log('   - Pump.fun AMM might use different instruction format');
    console.log('   - Parser not recognizing pump.fun AMM trade format');
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  }
}

// Run debug
debugAMMMonitoring().catch(console.error);