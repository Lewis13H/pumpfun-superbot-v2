/**
 * Fresh AMM Monitor Test
 * Runs AMM monitors from clean database and captures detailed data
 */

import dotenv from 'dotenv';
import { createContainer } from './core/container-factory';
import { TOKENS } from './core/container';
import { Logger } from './core/logger';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
// import { LAMPORTS_PER_SOL } from '@solana/web3.js';

// Load environment
dotenv.config();

// Constants
// const TOKEN_DECIMALS = 6;
const TARGET_TRADES = 50;
const SAMPLE_TOKENS = 10;
// const SAMPLE_TRADES = 4;

// Statistics
const stats = {
  startTime: Date.now(),
  totalTrades: 0,
  buys: 0,
  sells: 0,
  uniqueTokens: new Set<string>(),
  tokensSaved: new Set<string>(),
  trades: [] as any[],
  tokens: [] as any[],
  sampleBuyTrades: [] as any[],
  sampleSellTrades: [] as any[],
  errors: [] as any[]
};

// Real-time trade display
function displayTrade(trade: any) {
  const type = trade.tradeType === 'buy' ? chalk.green('BUY ') : chalk.red('SELL');
  const mint = trade.mintAddress.slice(0, 8) + '...';
  const sol = trade.solAmount.toFixed(4);
  const price = trade.priceUsd?.toFixed(8) || '0.00000000';
  const volume = trade.volumeUsd?.toFixed(2) || '0.00';
  
  console.log(
    `${type} ${chalk.cyan(mint)} | ` +
    `${chalk.yellow(sol + ' SOL')} | ` +
    `$${chalk.green(price)} | ` +
    `Vol: $${chalk.white(volume)} | ` +
    `${chalk.gray(trade.signature.slice(0, 16) + '...')}`
  );
}

async function runFreshAMMTest() {
  const logger = new Logger({ context: 'AMM Fresh Test' });
  logger.info('Starting fresh AMM monitor test...');

  try {
    // Create container
    const container = await createContainer();
    
    // Import monitor classes
    const { AMMMonitor } = await import('./monitors/amm-monitor');
    const { AMMAccountMonitor } = await import('./monitors/amm-account-monitor');
    
    // Get services
    const eventBus = await container.resolve(TOKENS.EventBus);
    const streamManager = await container.resolve(TOKENS.StreamManager);
    const priceService = await container.resolve(TOKENS.SolPriceService) as any;
    
    // Get current SOL price
    const solPrice = await priceService.getPrice();
    logger.info(`Current SOL price: $${solPrice.toFixed(2)}`);
    
    // Track all trades
    eventBus.on('AMM_TRADE', async (data: any) => {
      try {
        const trade = data.trade;
        stats.totalTrades++;
        stats.uniqueTokens.add(trade.mintAddress);
        
        if (trade.tradeType === 'buy') {
          stats.buys++;
          if (stats.sampleBuyTrades.length < 2) {
            stats.sampleBuyTrades.push({
              ...trade,
              rawEvent: data.rawEvent,
              capturedAt: new Date()
            });
          }
        } else {
          stats.sells++;
          if (stats.sampleSellTrades.length < 2) {
            stats.sampleSellTrades.push({
              ...trade,
              rawEvent: data.rawEvent,
              capturedAt: new Date()
            });
          }
        }
        
        // Store trade
        stats.trades.push(trade);
        
        // Display trade
        displayTrade(trade);
        
        // Progress update
        if (stats.totalTrades % 10 === 0) {
          logger.info(`Progress: ${stats.totalTrades} trades, ${stats.uniqueTokens.size} unique tokens`);
        }
        
      } catch (error) {
        logger.error('Error processing trade:', error as Error);
        stats.errors.push({ type: 'trade_processing', error, trade: data });
      }
    });
    
    // Track saved tokens
    eventBus.on('TOKEN_SAVED', (data: any) => {
      stats.tokensSaved.add(data.mintAddress);
      stats.tokens.push(data);
      logger.info(`💾 Token saved: ${data.symbol || 'Unknown'} (${data.mintAddress.slice(0, 8)}...)`);
    });
    
    // Track errors
    eventBus.on('ERROR', (data: any) => {
      stats.errors.push(data);
    });
    
    // Create monitors
    const monitors = [
      new AMMMonitor(container),
      new AMMAccountMonitor(container)
    ];
    
    // Register with stream manager
    for (const monitor of monitors) {
      (streamManager as any).addMonitor(monitor);
    }
    
    // Start stream
    await streamManager.start();
    
    logger.info('AMM monitors running...');
    logger.info('Capturing trades for analysis...');
    
    // Run for specified time or until target reached
    const testDuration = 5 * 60 * 1000; // 5 minutes
    const checkInterval = setInterval(() => {
      if (stats.totalTrades >= TARGET_TRADES || Date.now() - stats.startTime > testDuration) {
        clearInterval(checkInterval);
        stopAndAnalyze();
      }
    }, 1000);
    
    // Stop and analyze function
    async function stopAndAnalyze() {
      logger.info('Stopping monitors and analyzing data...');
      
      // Stop stream
      await streamManager.stop();
      
      // Wait for any pending saves
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Query database
      const dbService = await container.resolve(TOKENS.DatabaseService) as any;
      
      // Get saved trades
      const savedTrades = await dbService.getConnection().query(`
        SELECT * FROM trades_unified 
        WHERE program = 'amm_pool' 
        ORDER BY created_at DESC
      `);
      
      // Get saved tokens
      const savedTokens = await dbService.getConnection().query(`
        SELECT * FROM tokens_unified 
        WHERE graduated_to_amm = true 
        ORDER BY created_at DESC
      `);
      
      // Get pool states
      const poolStates = await dbService.getConnection().query(`
        SELECT * FROM amm_pool_states 
        ORDER BY slot DESC
        LIMIT 20
      `);
      
      // Generate report
      await generateReport(savedTrades.rows, savedTokens.rows, poolStates.rows);
      
      logger.info('Test complete!');
      process.exit(0);
    }
    
  } catch (error) {
    logger.error('Test failed:', error as Error);
    process.exit(1);
  }
}

async function generateReport(dbTrades: any[], dbTokens: any[], dbPools: any[]) {
  const logger = new Logger({ context: 'Report' });
  
  let report = `# AMM Monitor Fresh Test Report

Generated: ${new Date().toISOString()}
Test Duration: ${Math.floor((Date.now() - stats.startTime) / 1000)} seconds

## Summary Statistics

### Captured Data
- **Total Trades Captured**: ${stats.totalTrades}
- **Buy Orders**: ${stats.buys} (${(stats.buys / stats.totalTrades * 100).toFixed(1)}%)
- **Sell Orders**: ${stats.sells} (${(stats.sells / stats.totalTrades * 100).toFixed(1)}%)
- **Unique Tokens**: ${stats.uniqueTokens.size}
- **Tokens Saved**: ${stats.tokensSaved.size}
- **Errors**: ${stats.errors.length}

### Database Records
- **Trades in DB**: ${dbTrades.length}
- **Tokens in DB**: ${dbTokens.length}
- **Pool States**: ${dbPools.length}
- **Save Rate**: ${(dbTrades.length / stats.totalTrades * 100).toFixed(1)}%

## Sample Trade Analysis (4 trades: 2 buy, 2 sell)

`;

  // Analyze sample trades
  const sampleTrades = [...stats.sampleBuyTrades, ...stats.sampleSellTrades];
  
  for (let i = 0; i < sampleTrades.length; i++) {
    const trade = sampleTrades[i];
    const dbTrade = dbTrades.find(t => t.signature === trade.signature);
    
    report += `### Trade ${i + 1}: ${trade.tradeType.toUpperCase()}

#### Transaction Details
- **Signature**: \`${trade.signature}\`
- **Solscan**: https://solscan.io/tx/${trade.signature}
- **Captured At**: ${trade.capturedAt}

#### Parsed Data
\`\`\`json
{
  "mintAddress": "${trade.mintAddress}",
  "userAddress": "${trade.userAddress}",
  "poolAddress": "${trade.poolAddress || 'N/A'}",
  "solAmount": ${trade.solAmount},
  "tokenAmount": ${trade.tokenAmount},
  "priceUsd": ${trade.priceUsd || 0},
  "marketCapUsd": ${trade.marketCapUsd || 0},
  "volumeUsd": ${trade.volumeUsd || 0}
}
\`\`\`

#### Database Record
${dbTrade ? `✅ Saved to database
\`\`\`json
{
  "sol_amount": ${dbTrade.sol_amount},
  "token_amount": ${dbTrade.token_amount},
  "price_usd": ${dbTrade.price_usd},
  "market_cap_usd": ${dbTrade.market_cap_usd},
  "volume_usd": ${dbTrade.volume_usd}
}
\`\`\`` : '❌ NOT found in database'}

---

`;
  }
  
  // Random token sample
  report += `## Random Token Sample (10 tokens)

| # | Mint | Symbol | Name | Price USD | Market Cap | Pump.fun | Solscan |
|---|------|--------|------|-----------|------------|----------|---------|
`;

  // Get 10 random tokens
  const tokenSample = Array.from(stats.uniqueTokens).slice(0, SAMPLE_TOKENS);
  
  for (let i = 0; i < tokenSample.length; i++) {
    const mint = tokenSample[i];
    const dbToken = dbTokens.find(t => t.mint_address === mint);
    const trades = stats.trades.filter(t => t.mintAddress === mint);
    const latestTrade = trades[trades.length - 1];
    
    report += `| ${i+1} | ${mint.slice(0,8)}... | ${dbToken?.symbol || 'N/A'} | ${dbToken?.name || 'N/A'} | $${latestTrade?.priceUsd?.toFixed(8) || '0'} | $${latestTrade?.marketCapUsd?.toFixed(0) || '0'} | [View](https://pump.fun/coin/${mint}) | [View](https://solscan.io/token/${mint}) |\n`;
  }
  
  report += `
## Data Accuracy Analysis

### What Should Be Saved

1. **trades_unified**:
   - All AMM trades with correct decimal conversion
   - Accurate price calculations
   - Valid market cap estimates

2. **tokens_unified**:
   - Tokens that meet $1,000 market cap threshold
   - Enriched metadata (symbol, name, social links)
   - graduated_to_amm = true

3. **amm_pool_states**:
   - Current pool reserves
   - Updated with each trade

### Actual Results

#### ✅ Successful
- Trades captured: ${stats.totalTrades}
- Unique tokens identified: ${stats.uniqueTokens.size}

#### ❌ Issues
${dbTrades.length === 0 ? '- No trades saved to database\n' : ''}
${dbTokens.length === 0 ? '- No tokens saved (likely due to price/threshold issues)\n' : ''}
${stats.errors.length > 0 ? `- ${stats.errors.length} errors encountered\n` : ''}

### Verification URLs

Sample trades for manual verification:
`;

  // Add verification URLs
  for (let i = 0; i < Math.min(4, sampleTrades.length); i++) {
    const trade = sampleTrades[i];
    report += `
${i+1}. ${trade.tradeType.toUpperCase()} - ${trade.mintAddress}
   - Solscan: https://solscan.io/tx/${trade.signature}
   - Pump.fun: https://pump.fun/coin/${trade.mintAddress}
`;
  }
  
  report += `
## Errors Encountered

Total errors: ${stats.errors.length}
`;
  
  if (stats.errors.length > 0) {
    report += '\n```json\n' + JSON.stringify(stats.errors.slice(0, 5), null, 2) + '\n```\n';
  }
  
  // Save report
  const outputDir = path.join(__dirname, '../test-results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const reportFile = path.join(outputDir, 'AMM_FRESH_TEST_REPORT.md');
  fs.writeFileSync(reportFile, report);
  logger.info(`Report saved to: ${reportFile}`);
  
  // Save raw data
  const rawData = {
    stats,
    dbTrades: dbTrades.slice(0, 20),
    dbTokens,
    dbPools,
    sampleTrades
  };
  
  const dataFile = path.join(outputDir, 'amm-fresh-test-data.json');
  fs.writeFileSync(dataFile, JSON.stringify(rawData, null, 2));
  logger.info(`Raw data saved to: ${dataFile}`);
}

// Run the test
runFreshAMMTest().catch(console.error);