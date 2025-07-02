/**
 * AMM-Only Monitor Test
 * Runs AMM transaction and account monitors to capture detailed trade data
 */

import { createContainer } from './core/container-factory';
import { TOKENS } from './core/container';
import { AMMMonitor } from './monitors/amm-monitor';
import { AMMAccountMonitor } from './monitors/amm-account-monitor';
import { Logger } from './core/logger';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

// Constants
const TOKEN_DECIMALS = 6;
const TARGET_TRADES = 50;
const SAMPLE_TRADES = 4; // 2 buy, 2 sell

interface DetailedTrade {
  // Transaction info
  signature: string;
  slot: number;
  blockTime: Date;
  
  // Trade details
  type: 'buy' | 'sell';
  mintAddress: string;
  userAddress: string;
  poolAddress?: string;
  
  // Amounts (raw and formatted)
  rawSolAmount: string;
  rawTokenAmount: string;
  solAmount: number;
  tokenAmount: number;
  
  // Price data
  pricePerTokenUsd: number;
  pricePerTokenSol: number;
  marketCapUsd: number;
  volumeUsd: number;
  
  // Pool state at trade time
  poolReserves?: {
    virtualSolReserves: string;
    virtualTokenReserves: string;
    solReservesFormatted: number;
    tokenReservesFormatted: number;
  };
  
  // Fees
  protocolFee?: number;
  lpFee?: number;
  
  // Token metadata
  symbol?: string;
  name?: string;
  
  // URLs for verification
  solscanUrl: string;
  pumpfunUrl: string;
  
  // What we parsed
  parsedData: any;
  
  // Raw event data
  rawEventData?: any;
}

// Statistics
const stats = {
  startTime: Date.now(),
  totalTrades: 0,
  buys: 0,
  sells: 0,
  uniqueTokens: new Set<string>(),
  capturedTrades: [] as DetailedTrade[],
  buyTrades: [] as DetailedTrade[],
  sellTrades: [] as DetailedTrade[]
};

async function runAMMMonitorsOnly() {
  const logger = new Logger({ context: 'AMM Test' });
  logger.info('Starting AMM-only monitors test...');
  logger.info(`Target: Capture ${TARGET_TRADES} trades`);

  try {
    // Create container
    const container = await createContainer();
    
    // Get services
    const eventBus = await container.resolve(TOKENS.EventBus);
    const priceService = await container.resolve(TOKENS.SolPriceService) as any;
    // const dbService = await container.resolve(TOKENS.DatabaseService);
    const poolStateService = await container.resolve(TOKENS.PoolStateService);
    
    // Get current SOL price
    const currentSolPrice = await priceService.getPrice();
    logger.info(`Current SOL price: $${currentSolPrice.toFixed(2)}`);
    
    // Listen for detailed trade events
    eventBus.on('AMM_TRADE', async (data: any) => {
      try {
        stats.totalTrades++;
        stats.uniqueTokens.add(data.trade.mintAddress);
        
        const trade = data.trade;
        const isBuy = trade.tradeType === 'buy';
        
        if (isBuy) {
          stats.buys++;
        } else {
          stats.sells++;
        }
        
        // Get pool state
        const poolState = poolStateService.getPoolState(trade.mintAddress);
        
        // Create detailed trade record
        const detailedTrade: DetailedTrade = {
          // Transaction info
          signature: trade.signature,
          slot: trade.slot,
          blockTime: trade.blockTime,
          
          // Trade details
          type: trade.tradeType,
          mintAddress: trade.mintAddress,
          userAddress: trade.userAddress,
          poolAddress: trade.poolAddress,
          
          // Raw amounts
          rawSolAmount: (trade.solAmount * LAMPORTS_PER_SOL).toString(),
          rawTokenAmount: (trade.tokenAmount * Math.pow(10, TOKEN_DECIMALS)).toString(),
          
          // Formatted amounts
          solAmount: trade.solAmount,
          tokenAmount: trade.tokenAmount,
          
          // Price data
          pricePerTokenUsd: trade.priceUsd || 0,
          pricePerTokenSol: trade.solAmount / trade.tokenAmount,
          marketCapUsd: trade.marketCapUsd || 0,
          volumeUsd: trade.volumeUsd,
          
          // Pool reserves if available
          poolReserves: poolState ? {
            virtualSolReserves: (poolState.reserves.virtualSolReserves * LAMPORTS_PER_SOL).toString(),
            virtualTokenReserves: (poolState.reserves.virtualTokenReserves * Math.pow(10, TOKEN_DECIMALS)).toString(),
            solReservesFormatted: poolState.reserves.virtualSolReserves,
            tokenReservesFormatted: poolState.reserves.virtualTokenReserves
          } : undefined,
          
          // URLs
          solscanUrl: `https://solscan.io/tx/${trade.signature}`,
          pumpfunUrl: `https://pump.fun/coin/${trade.mintAddress}`,
          
          // Parsed data
          parsedData: trade,
          
          // Raw event if available
          rawEventData: data.rawEvent
        };
        
        // Add to captured trades
        stats.capturedTrades.push(detailedTrade);
        
        if (isBuy && stats.buyTrades.length < 2) {
          stats.buyTrades.push(detailedTrade);
          logger.info(chalk.green(`Captured BUY sample ${stats.buyTrades.length}/2`), {
            signature: trade.signature,
            mint: trade.mintAddress.slice(0, 8) + '...',
            volume: `$${trade.volumeUsd.toFixed(2)}`
          });
        } else if (!isBuy && stats.sellTrades.length < 2) {
          stats.sellTrades.push(detailedTrade);
          logger.info(chalk.red(`Captured SELL sample ${stats.sellTrades.length}/2`), {
            signature: trade.signature,
            mint: trade.mintAddress.slice(0, 8) + '...',
            volume: `$${trade.volumeUsd.toFixed(2)}`
          });
        }
        
        // Log progress
        if (stats.totalTrades % 10 === 0) {
          logger.info(`Progress: ${stats.totalTrades}/${TARGET_TRADES} trades captured`, {
            buys: stats.buys,
            sells: stats.sells,
            uniqueTokens: stats.uniqueTokens.size
          });
        }
        
        // Check if we've captured enough trades
        if (stats.totalTrades >= TARGET_TRADES) {
          logger.info('Target trades reached, preparing to stop monitors...');
          setTimeout(async () => {
            await stopMonitorsAndAnalyze();
          }, 5000); // Wait 5 seconds to ensure data is saved
        }
        
      } catch (error) {
        logger.error('Error processing trade event:', error as Error);
      }
    });
    
    // Create monitors
    const ammMonitor = new AMMMonitor(container);
    const ammAccountMonitor = new AMMAccountMonitor(container);
    
    // Store monitors for later shutdown
    (global as any).monitors = { ammMonitor, ammAccountMonitor };
    (global as any).container = container;
    (global as any).logger = logger;
    
    // Start monitors
    logger.info('Starting AMM monitors...');
    await Promise.all([
      ammMonitor.start(),
      ammAccountMonitor.start()
    ]);
    
    logger.info('AMM monitors running, capturing trades...');
    
    // Run until we capture enough trades
    // The event listener will trigger the analysis
    
  } catch (error) {
    logger.error('Monitor test failed:', error as Error);
    process.exit(1);
  }
}

async function stopMonitorsAndAnalyze() {
  const { monitors, container, logger } = global as any;
  
  try {
    // Stop monitors
    logger.info('Stopping monitors...');
    await Promise.all([
      monitors.ammMonitor.stop(),
      monitors.ammAccountMonitor.stop()
    ]);
    
    // Get database service
    const dbService = await container.resolve(TOKENS.DatabaseService);
    
    // Query database for saved data
    logger.info('Querying database for saved trades...');
    
    // Get sample trades from database
    const sampleSignatures = [
      ...stats.buyTrades.slice(0, 2).map(t => t.signature),
      ...stats.sellTrades.slice(0, 2).map(t => t.signature)
    ];
    
    const dbTrades = await dbService.query(`
      SELECT * FROM trades_unified 
      WHERE signature = ANY($1)
      ORDER BY created_at DESC
    `, [sampleSignatures]);
    
    // Get tokens from database
    const sampleMints = [...new Set([
      ...stats.buyTrades.slice(0, 2).map(t => t.mintAddress),
      ...stats.sellTrades.slice(0, 2).map(t => t.mintAddress)
    ])];
    
    const dbTokens = await dbService.query(`
      SELECT * FROM tokens_unified
      WHERE mint_address = ANY($1)
    `, [sampleMints]);
    
    // Generate report
    await generateAccuracyReport(stats, dbTrades.rows, dbTokens.rows);
    
    logger.info('Analysis complete!');
    process.exit(0);
    
  } catch (error) {
    logger.error('Error during analysis:', error as Error);
    process.exit(1);
  }
}

async function generateAccuracyReport(
  stats: any,
  dbTrades: any[],
  dbTokens: any[]
) {
  const logger = new Logger({ context: 'Report' });
  
  let report = `# AMM Monitor Accuracy Analysis Report

Generated: ${new Date().toISOString()}
Runtime: ${Math.floor((Date.now() - stats.startTime) / 1000)} seconds

## Summary Statistics

- **Total Trades Captured**: ${stats.totalTrades}
- **Buy Orders**: ${stats.buys}
- **Sell Orders**: ${stats.sells}
- **Unique Tokens**: ${stats.uniqueTokens.size}
- **Sample Trades Analyzed**: ${SAMPLE_TRADES} (2 buy, 2 sell)

## Sample Trade Analysis

`;

  // Analyze each sample trade
  const sampleTrades = [
    ...stats.buyTrades.slice(0, 2),
    ...stats.sellTrades.slice(0, 2)
  ];
  
  for (let i = 0; i < sampleTrades.length; i++) {
    const trade = sampleTrades[i];
    const dbTrade = dbTrades.find(t => t.signature === trade.signature);
    const dbToken = dbTokens.find(t => t.mint_address === trade.mintAddress);
    
    report += `### Trade ${i + 1}: ${trade.type.toUpperCase()}

#### Transaction Details
- **Signature**: \`${trade.signature}\`
- **Solscan**: ${trade.solscanUrl}
- **Pump.fun**: ${trade.pumpfunUrl}
- **Slot**: ${trade.slot}
- **Block Time**: ${trade.blockTime}

#### Parsed Data
\`\`\`json
{
  "type": "${trade.type}",
  "mintAddress": "${trade.mintAddress}",
  "userAddress": "${trade.userAddress}",
  "poolAddress": "${trade.poolAddress || 'N/A'}",
  "solAmount": ${trade.solAmount},
  "tokenAmount": ${trade.tokenAmount.toLocaleString()},
  "rawSolAmount": "${trade.rawSolAmount}",
  "rawTokenAmount": "${trade.rawTokenAmount}",
  "pricePerTokenUsd": ${trade.pricePerTokenUsd.toFixed(12)},
  "pricePerTokenSol": ${trade.pricePerTokenSol.toFixed(12)},
  "marketCapUsd": ${trade.marketCapUsd.toFixed(2)},
  "volumeUsd": ${trade.volumeUsd.toFixed(2)}
}
\`\`\`

#### Pool Reserves at Trade Time
${trade.poolReserves ? `\`\`\`json
{
  "virtualSolReserves": "${trade.poolReserves.virtualSolReserves}",
  "virtualTokenReserves": "${trade.poolReserves.virtualTokenReserves}",
  "solReservesFormatted": ${trade.poolReserves.solReservesFormatted.toFixed(9)},
  "tokenReservesFormatted": ${trade.poolReserves.tokenReservesFormatted.toLocaleString()}
}
\`\`\`` : 'No pool reserves available'}

#### Database Record (trades_unified)
${dbTrade ? `\`\`\`json
{
  "signature": "${dbTrade.signature}",
  "mint_address": "${dbTrade.mint_address}",
  "program": "${dbTrade.program}",
  "trade_type": "${dbTrade.trade_type}",
  "user_address": "${dbTrade.user_address}",
  "sol_amount": ${dbTrade.sol_amount},
  "token_amount": ${dbTrade.token_amount},
  "price_usd": ${dbTrade.price_usd},
  "market_cap_usd": ${dbTrade.market_cap_usd},
  "volume_usd": ${dbTrade.volume_usd}
}
\`\`\`` : '❌ Trade not found in database'}

#### Token Record (tokens_unified)
${dbToken ? `\`\`\`json
{
  "mint_address": "${dbToken.mint_address}",
  "symbol": "${dbToken.symbol || 'N/A'}",
  "name": "${dbToken.name || 'N/A'}",
  "first_price_usd": ${dbToken.first_price_usd},
  "first_market_cap_usd": ${dbToken.first_market_cap_usd},
  "graduated_to_amm": ${dbToken.graduated_to_amm}
}
\`\`\`` : '❌ Token not found in database'}

---

`;
  }
  
  report += `## Data Accuracy Verification

### ✅ What Should Be Saved to Database

#### trades_unified table
- signature (PRIMARY KEY)
- mint_address
- program = 'amm_pool'
- trade_type ('buy' or 'sell')
- user_address
- sol_amount (in SOL, not lamports)
- token_amount (with decimals applied)
- price_usd
- market_cap_usd
- volume_usd
- slot
- block_time

#### tokens_unified table
- mint_address (PRIMARY KEY)
- symbol
- name
- first_price_sol
- first_price_usd
- first_market_cap_usd
- graduated_to_amm = true
- metadata (if enriched)

### 📊 Database Save Statistics

- **Trades Saved**: ${dbTrades.length}/${SAMPLE_TRADES} sample trades
- **Tokens Saved**: ${dbTokens.length} tokens
- **Save Rate**: ${(dbTrades.length / SAMPLE_TRADES * 100).toFixed(1)}%

### 🔍 Verification Steps

1. **Check Solscan URLs**: Verify each transaction exists and matches our parsed data
2. **Check Pump.fun URLs**: Verify token exists and is graduated to AMM
3. **Compare Amounts**: Ensure SOL and token amounts match blockchain data
4. **Verify Price**: Check if calculated price matches market data
5. **Pool State**: Confirm reserves are accurate if available

## Conclusion

${dbTrades.length === SAMPLE_TRADES ? 
  '✅ All sample trades were successfully saved to the database' : 
  `⚠️ Only ${dbTrades.length}/${SAMPLE_TRADES} sample trades were saved to the database`}

${dbTokens.length > 0 ? 
  `✅ ${dbTokens.length} tokens were saved with metadata` : 
  '❌ No tokens were saved to the database (likely due to price threshold)'}

### Next Steps
1. Manually verify the Solscan URLs to confirm transaction accuracy
2. Check pump.fun URLs to verify token graduation status
3. Compare parsed amounts with blockchain data
4. Review any missing database records
`;

  // Save report
  const outputDir = path.join(__dirname, '../test-results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const reportFile = path.join(outputDir, 'AMM_ACCURACY_ANALYSIS.md');
  fs.writeFileSync(reportFile, report);
  logger.info(`Report saved to: ${reportFile}`);
  
  // Also save raw data
  const rawDataFile = path.join(outputDir, 'amm-test-raw-data.json');
  fs.writeFileSync(rawDataFile, JSON.stringify({
    stats,
    sampleTrades,
    dbTrades,
    dbTokens
  }, null, 2));
  logger.info(`Raw data saved to: ${rawDataFile}`);
}

// Run the test
runAMMMonitorsOnly().catch(console.error);