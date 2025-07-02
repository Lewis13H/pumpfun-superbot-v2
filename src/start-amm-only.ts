/**
 * Start script for AMM monitors only
 */

import dotenv from 'dotenv';
import { createContainer } from './core/container-factory';
import { TOKENS } from './core/container';
import { AMMMonitor } from './monitors/amm-monitor';
import { AMMAccountMonitor } from './monitors/amm-account-monitor';
import { Logger } from './core/logger';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const logger = new Logger({ context: 'AMM Only' });

// Capture statistics
const stats = {
  startTime: Date.now(),
  trades: [] as any[],
  buyTrades: [] as any[],
  sellTrades: [] as any[],
  uniqueTokens: new Set<string>()
};

async function startAMMOnly() {
  logger.info('Starting AMM monitors only...');
  
  try {
    // Create container
    const container = await createContainer();
    
    // Get services
    const eventBus = await container.resolve(TOKENS.EventBus);
    const streamManager = await container.resolve(TOKENS.StreamManager);
    const dbService = await container.resolve(TOKENS.DatabaseService);
    
    // Listen for trade events
    eventBus.on('TRADE_PROCESSED', async (data: any) => {
      if (data.program === 'amm_pool') {
        const trade = {
          signature: data.signature,
          type: data.tradeType,
          mint: data.mint,
          user: data.userAddress,
          solAmount: data.solAmount / 1e9,
          tokenAmount: data.tokenAmount / 1e6,
          priceUsd: data.priceUsd,
          marketCapUsd: data.marketCapUsd,
          volumeUsd: data.volumeUsd || (data.solAmount * data.solPrice / 1e9),
          timestamp: new Date(),
          solscanUrl: `https://solscan.io/tx/${data.signature}`,
          pumpfunUrl: `https://pump.fun/coin/${data.mint}`,
          rawData: data
        };
        
        stats.trades.push(trade);
        stats.uniqueTokens.add(data.mint);
        
        if (data.tradeType === 'buy' && stats.buyTrades.length < 2) {
          stats.buyTrades.push(trade);
          logger.info(`📈 Captured BUY sample ${stats.buyTrades.length}/2`, {
            signature: trade.signature,
            mint: trade.mint.slice(0, 8) + '...',
            volume: `$${trade.volumeUsd.toFixed(2)}`
          });
        } else if (data.tradeType === 'sell' && stats.sellTrades.length < 2) {
          stats.sellTrades.push(trade);
          logger.info(`📉 Captured SELL sample ${stats.sellTrades.length}/2`, {
            signature: trade.signature,
            mint: trade.mint.slice(0, 8) + '...',
            volume: `$${trade.volumeUsd.toFixed(2)}`
          });
        }
        
        // Log progress
        if (stats.trades.length % 10 === 0) {
          logger.info(`Progress: ${stats.trades.length} trades captured`, {
            uniqueTokens: stats.uniqueTokens.size
          });
        }
        
        // Stop after 50 trades
        if (stats.trades.length >= 50) {
          setTimeout(async () => {
            await generateReport();
            process.exit(0);
          }, 5000);
        }
      }
    });
    
    // Create stream manager and monitors
    const monitors = [
      new AMMMonitor(container),
      new AMMAccountMonitor(container)
    ];
    
    // Register monitors with stream manager
    for (const monitor of monitors) {
      streamManager.registerMonitor(monitor);
    }
    
    // Start stream manager
    await streamManager.start();
    
    logger.info('AMM monitors running, capturing trades...');
    
    // Generate report function
    async function generateReport() {
      logger.info('Generating accuracy report...');
      
      // Get sample trades from database
      const sampleSignatures = [
        ...stats.buyTrades.slice(0, 2).map(t => t.signature),
        ...stats.sellTrades.slice(0, 2).map(t => t.signature)
      ];
      
      const dbTrades = await dbService.query(`
        SELECT * FROM trades_unified 
        WHERE signature = ANY($1)
      `, [sampleSignatures]);
      
      const sampleMints = [...new Set([
        ...stats.buyTrades.slice(0, 2).map(t => t.mint),
        ...stats.sellTrades.slice(0, 2).map(t => t.mint)
      ])];
      
      const dbTokens = await dbService.query(`
        SELECT * FROM tokens_unified
        WHERE mint_address = ANY($1)
      `, [sampleMints]);
      
      let report = `# AMM Monitor Accuracy Analysis Report

Generated: ${new Date().toISOString()}
Runtime: ${Math.floor((Date.now() - stats.startTime) / 1000)} seconds

## Summary Statistics

- **Total Trades Captured**: ${stats.trades.length}
- **Buy Orders**: ${stats.buyTrades.length}
- **Sell Orders**: ${stats.sellTrades.length}
- **Unique Tokens**: ${stats.uniqueTokens.size}
- **Sample Trades**: 4 (2 buy, 2 sell)

## Sample Trade Analysis

`;

      // Add sample trades
      const samples = [...stats.buyTrades.slice(0, 2), ...stats.sellTrades.slice(0, 2)];
      
      for (let i = 0; i < samples.length; i++) {
        const trade = samples[i];
        const dbTrade = dbTrades.rows.find((t: any) => t.signature === trade.signature);
        const dbToken = dbTokens.rows.find((t: any) => t.mint_address === trade.mint);
        
        report += `### Trade ${i + 1}: ${trade.type.toUpperCase()}

#### Transaction Details
- **Signature**: \`${trade.signature}\`
- **Solscan**: ${trade.solscanUrl}
- **Pump.fun**: ${trade.pumpfunUrl}
- **Time**: ${trade.timestamp.toISOString()}

#### Parsed Data
\`\`\`json
{
  "type": "${trade.type}",
  "mint": "${trade.mint}",
  "user": "${trade.user}",
  "solAmount": ${trade.solAmount.toFixed(9)},
  "tokenAmount": ${trade.tokenAmount.toLocaleString()},
  "priceUsd": ${trade.priceUsd.toFixed(12)},
  "marketCapUsd": ${trade.marketCapUsd.toFixed(2)},
  "volumeUsd": ${trade.volumeUsd.toFixed(2)}
}
\`\`\`

#### Database Record
${dbTrade ? `✅ Trade saved to database
\`\`\`json
{
  "sol_amount": ${dbTrade.sol_amount},
  "token_amount": ${dbTrade.token_amount},
  "price_usd": ${dbTrade.price_usd},
  "market_cap_usd": ${dbTrade.market_cap_usd}
}
\`\`\`` : '❌ Trade not found in database'}

#### Token Record
${dbToken ? `✅ Token saved: ${dbToken.symbol || 'N/A'} (${dbToken.name || 'N/A'})` : '❌ Token not saved (likely below $1000 threshold)'}

---

`;
      }
      
      report += `## Data Accuracy Verification

### What Should Be Saved

1. **trades_unified**: All AMM trades with correct amounts
2. **tokens_unified**: Tokens that meet $1000 market cap threshold

### Results

- **Trades Saved**: ${dbTrades.rows.length}/${samples.length} sample trades
- **Tokens Saved**: ${dbTokens.rows.length} tokens
- **Save Rate**: ${(dbTrades.rows.length / samples.length * 100).toFixed(1)}%

### Verification Steps

1. Click the Solscan URLs to verify transactions exist
2. Check pump.fun URLs to verify tokens are graduated to AMM
3. Compare amounts and prices with blockchain data
`;

      // Save report
      const outputDir = path.join(__dirname, '../test-results');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      fs.writeFileSync(
        path.join(outputDir, 'AMM_MONITOR_ACCURACY.md'),
        report
      );
      
      // Save raw data
      fs.writeFileSync(
        path.join(outputDir, 'amm-test-data.json'),
        JSON.stringify({ stats, dbTrades: dbTrades.rows, dbTokens: dbTokens.rows }, null, 2)
      );
      
      logger.info('Report generated: test-results/AMM_MONITOR_ACCURACY.md');
    }
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down AMM monitors...');
      await streamManager.stop();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start AMM monitors:', error as Error);
    process.exit(1);
  }
}

// Start the monitors
startAMMOnly().catch(console.error);