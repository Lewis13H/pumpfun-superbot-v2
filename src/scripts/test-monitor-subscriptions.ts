#!/usr/bin/env node

/**
 * Test monitor subscriptions to verify they're subscribing to the right programs
 */

import { Container } from '../core/container';
import { TradingActivityMonitor } from '../monitors/domain/trading-activity-monitor';
import { LiquidityMonitor } from '../monitors/domain/liquidity-monitor';
import { TokenLifecycleMonitor } from '../monitors/domain/token-lifecycle-monitor';
import chalk from 'chalk';

async function testMonitorSubscriptions() {
  console.log(chalk.cyan('🔍 Testing Monitor Subscriptions\n'));
  
  const container = new Container();
  
  try {
    // Test TradingActivityMonitor
    console.log(chalk.yellow('1. TradingActivityMonitor:'));
    const tradingMonitor = new TradingActivityMonitor(container);
    
    // Access the protected method through a workaround
    const tradingRequest = (tradingMonitor as any).buildEnhancedSubscribeRequest();
    console.log('  Programs monitored:', (tradingMonitor as any).getProgramIds());
    console.log('  Subscription:', JSON.stringify(tradingRequest, null, 2));
    
    // Test LiquidityMonitor
    console.log(chalk.yellow('\n2. LiquidityMonitor:'));
    const liquidityMonitor = new LiquidityMonitor(container);
    
    const liquidityRequest = (liquidityMonitor as any).buildEnhancedSubscribeRequest();
    console.log('  Subscription:', JSON.stringify(liquidityRequest, null, 2));
    
    // Test TokenLifecycleMonitor
    console.log(chalk.yellow('\n3. TokenLifecycleMonitor:'));
    const tokenMonitor = new TokenLifecycleMonitor(container);
    
    const tokenRequest = (tokenMonitor as any).buildEnhancedSubscribeRequest();
    console.log('  Subscription:', JSON.stringify(tokenRequest, null, 2));
    
    // Summary
    console.log(chalk.cyan('\n📊 Summary:'));
    
    const tradingSubs = tradingRequest.transactions || {};
    const hasAMMSub = Object.values(tradingSubs).some((sub: any) => 
      sub.accountInclude?.includes('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA')
    );
    
    console.log('  TradingActivityMonitor subscribes to AMM:', hasAMMSub ? chalk.green('YES') : chalk.red('NO'));
    
    const liquiditySubs = liquidityRequest.transactions || {};
    const liquidityHasAMM = Object.values(liquiditySubs).some((sub: any) => 
      sub.accountInclude?.includes('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA')
    );
    
    console.log('  LiquidityMonitor subscribes to AMM:', liquidityHasAMM ? chalk.green('YES') : chalk.red('NO'));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  }
}

// Run test
testMonitorSubscriptions().catch(console.error);