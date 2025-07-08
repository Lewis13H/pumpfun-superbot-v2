#!/usr/bin/env npx tsx

import 'dotenv/config';
import chalk from 'chalk';
import { createContainer } from '../core/container-factory';
import { EventBus, EVENTS } from '../core/event-bus';
import { Pool } from 'pg';

async function testAMMTokenCreation() {
  console.log(chalk.cyan('🚀 Starting AMM token creation test...\n'));

  // Create container
  const container = await createContainer();
  const eventBus = await container.resolve('EventBus') as EventBus;
  
  // Create database connection
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  // Track AMM trades
  const ammTrades = new Map<string, number>();
  const tokenStatus = new Map<string, { exists: boolean; graduated: boolean }>();
  
  // Listen for AMM trades
  eventBus.on(EVENTS.AMM_TRADE, async (data) => {
    const trade = data.trade;
    const mintAddress = trade.mintAddress;
    
    // Count trades per token
    ammTrades.set(mintAddress, (ammTrades.get(mintAddress) || 0) + 1);
    
    // Check if token exists in database
    if (!tokenStatus.has(mintAddress)) {
      try {
        const result = await pool.query(
          'SELECT mint_address, graduated_to_amm, symbol, name, current_market_cap_usd FROM tokens_unified WHERE mint_address = $1',
          [mintAddress]
        );
        
        if (result.rows.length > 0) {
          const token = result.rows[0];
          tokenStatus.set(mintAddress, { 
            exists: true, 
            graduated: token.graduated_to_amm 
          });
          console.log(chalk.green(
            `✅ Token ${token.symbol || 'Unknown'} (${mintAddress.substring(0, 8)}...) ` +
            `exists in DB. Graduated: ${token.graduated_to_amm}, Market Cap: $${token.current_market_cap_usd || 0}`
          ));
        } else {
          tokenStatus.set(mintAddress, { exists: false, graduated: false });
          console.log(chalk.red(
            `❌ Token ${mintAddress.substring(0, 8)}... NOT in database`
          ));
        }
      } catch (error) {
        console.error(chalk.red('Database error:'), error);
      }
    }
  });
  
  // Listen for token creation events
  eventBus.on(EVENTS.TOKEN_CREATED, (data) => {
    console.log(chalk.yellow(
      `🆕 Token created: ${data.symbol || 'Unknown'} (${data.mintAddress.substring(0, 8)}...)`
    ));
  });
  
  // Start monitors
  console.log(chalk.cyan('Starting monitors...'));
  const { TradingActivityMonitor } = await import('../monitors/domain/trading-activity-monitor');
  const monitor = new TradingActivityMonitor(container);
  await monitor.start();
  
  console.log(chalk.green('✅ Monitor started. Listening for AMM trades...\n'));
  
  // Run for 30 seconds
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  // Show results
  console.log(chalk.cyan('\n\n📊 Results after 30 seconds:\n'));
  
  const totalTokens = ammTrades.size;
  const existingTokens = Array.from(tokenStatus.values()).filter(s => s.exists).length;
  const graduatedTokens = Array.from(tokenStatus.values()).filter(s => s.graduated).length;
  
  console.log(chalk.white(`Total unique AMM tokens traded: ${totalTokens}`));
  console.log(chalk.green(`Tokens in database: ${existingTokens} (${((existingTokens / totalTokens) * 100).toFixed(1)}%)`));
  console.log(chalk.blue(`Graduated tokens: ${graduatedTokens} (${((graduatedTokens / totalTokens) * 100).toFixed(1)}%)`));
  console.log(chalk.red(`Missing tokens: ${totalTokens - existingTokens} (${(((totalTokens - existingTokens) / totalTokens) * 100).toFixed(1)}%)`));
  
  // Show top traded tokens
  console.log(chalk.cyan('\n🔥 Top 10 traded tokens:'));
  const sortedTrades = Array.from(ammTrades.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
    
  for (const [mint, count] of sortedTrades) {
    const status = tokenStatus.get(mint);
    const statusStr = status?.exists ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${statusStr} ${mint.substring(0, 8)}... - ${count} trades`);
  }
  
  await pool.end();
  process.exit(0);
}

testAMMTokenCreation().catch(console.error);