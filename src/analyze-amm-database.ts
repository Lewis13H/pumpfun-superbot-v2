/**
 * Analyze existing AMM trades from database
 */

import { createContainer } from './core/container-factory';
import { TOKENS } from './core/container';
import { Logger } from './core/logger';
import fs from 'fs';
import path from 'path';

const logger = new Logger({ context: 'AMM Analysis' });

async function analyzeAMMDatabase() {
  logger.info('Analyzing AMM trades from database...');
  
  try {
    // Create container
    const container = await createContainer();
    const db = await container.resolve(TOKENS.DatabaseService) as any;
    
    // Get recent AMM trades
    logger.info('Querying recent AMM trades...');
    const recentTrades = await db.query(`
      SELECT 
        t.*,
        tok.symbol,
        tok.name,
        tok.metadata
      FROM trades_unified t
      LEFT JOIN tokens_unified tok ON t.mint_address = tok.mint_address
      WHERE t.program = 'amm_pool'
      ORDER BY t.created_at DESC
      LIMIT 100
    `);
    
    logger.info(`Found ${recentTrades.rows.length} recent AMM trades`);
    
    // Get statistics
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_trades,
        COUNT(DISTINCT mint_address) as unique_tokens,
        COUNT(CASE WHEN trade_type = 'buy' THEN 1 END) as buy_trades,
        COUNT(CASE WHEN trade_type = 'sell' THEN 1 END) as sell_trades,
        SUM(volume_usd) as total_volume,
        AVG(price_usd) as avg_price,
        MAX(market_cap_usd) as max_market_cap,
        MIN(created_at) as first_trade,
        MAX(created_at) as last_trade
      FROM trades_unified
      WHERE program = 'amm_pool'
    `);
    
    const statsData = stats.rows[0];
    
    // Get sample trades (2 buy, 2 sell)
    const buyTrades = await db.query(`
      SELECT * FROM trades_unified
      WHERE program = 'amm_pool' AND trade_type = 'buy'
      ORDER BY created_at DESC
      LIMIT 2
    `);
    
    const sellTrades = await db.query(`
      SELECT * FROM trades_unified
      WHERE program = 'amm_pool' AND trade_type = 'sell'
      ORDER BY created_at DESC
      LIMIT 2
    `);
    
    const sampleTrades = [...buyTrades.rows, ...sellTrades.rows];
    
    // Get token info for sample trades
    const mintAddresses = sampleTrades.map(t => t.mint_address);
    const tokenInfo = await db.query(`
      SELECT * FROM tokens_unified
      WHERE mint_address = ANY($1)
    `, [mintAddresses]);
    
    // Get pool states for sample trades
    const poolStates = await db.query(`
      SELECT * FROM amm_pool_states
      WHERE mint_address = ANY($1)
      ORDER BY last_updated DESC
    `, [mintAddresses]);
    
    // Generate report
    let report = `# AMM Database Analysis Report

Generated: ${new Date().toISOString()}

## Overall Statistics

- **Total AMM Trades**: ${statsData.total_trades}
- **Unique Tokens**: ${statsData.unique_tokens}
- **Buy Trades**: ${statsData.buy_trades}
- **Sell Trades**: ${statsData.sell_trades}
- **Total Volume**: $${parseFloat(statsData.total_volume || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
- **Average Price**: $${parseFloat(statsData.avg_price || 0).toFixed(8)}
- **Max Market Cap**: $${parseFloat(statsData.max_market_cap || 0).toLocaleString()}
- **First Trade**: ${statsData.first_trade}
- **Last Trade**: ${statsData.last_trade}

## Sample Trade Analysis (4 trades: 2 buy, 2 sell)

`;

    // Analyze each sample trade
    for (let i = 0; i < sampleTrades.length; i++) {
      const trade = sampleTrades[i];
      const token = tokenInfo.rows.find((t: any) => t.mint_address === trade.mint_address);
      const poolState = poolStates.rows.find((p: any) => p.mint_address === trade.mint_address);
      
      report += `### Trade ${i + 1}: ${trade.trade_type.toUpperCase()}

#### Transaction Details
- **Signature**: \`${trade.signature}\`
- **Solscan URL**: https://solscan.io/tx/${trade.signature}
- **Pump.fun URL**: https://pump.fun/coin/${trade.mint_address}
- **Block Time**: ${trade.block_time}
- **Slot**: ${trade.slot}

#### Trade Data (from database)
\`\`\`json
{
  "mint_address": "${trade.mint_address}",
  "user_address": "${trade.user_address}",
  "sol_amount": ${trade.sol_amount},
  "token_amount": ${trade.token_amount},
  "price_usd": ${trade.price_usd},
  "market_cap_usd": ${trade.market_cap_usd},
  "volume_usd": ${trade.volume_usd},
  "pool_address": "${trade.pool_address || 'N/A'}"
}
\`\`\`

#### Token Information
${token ? `\`\`\`json
{
  "symbol": "${token.symbol || 'N/A'}",
  "name": "${token.name || 'N/A'}",
  "first_price_usd": ${token.first_price_usd},
  "first_market_cap_usd": ${token.first_market_cap_usd},
  "graduated_to_amm": ${token.graduated_to_amm},
  "metadata_enriched": ${!!token.metadata}
}
\`\`\`` : 'Token not found in tokens_unified table'}

#### Pool State
${poolState ? `\`\`\`json
{
  "pool_address": "${poolState.pool_address}",
  "virtual_sol_reserves": ${poolState.virtual_sol_reserves},
  "virtual_token_reserves": ${poolState.virtual_token_reserves},
  "real_sol_reserves": ${poolState.real_sol_reserves},
  "real_token_reserves": ${poolState.real_token_reserves},
  "last_updated": "${poolState.last_updated}"
}
\`\`\`` : 'Pool state not found'}

#### Verification Steps
1. Click the Solscan URL to verify:
   - Transaction exists and is successful
   - Program ID is pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA (pump AMM)
   - SOL and token amounts match our database
   
2. Click the pump.fun URL to verify:
   - Token is graduated to AMM
   - Current price and market cap
   - Trading activity

---

`;
    }
    
    // Add data accuracy section
    report += `## Data Accuracy Analysis

### Expected vs Actual Data

#### What Should Be Saved:
1. **trades_unified table**:
   - ✅ signature (transaction hash)
   - ✅ mint_address (token)
   - ✅ program = 'amm_pool'
   - ✅ trade_type ('buy' or 'sell')
   - ✅ user_address
   - ✅ sol_amount (in SOL, not lamports)
   - ✅ token_amount (with decimals)
   - ✅ price_usd
   - ✅ market_cap_usd
   - ✅ volume_usd

2. **tokens_unified table**:
   - ✅ mint_address
   - ✅ symbol & name (if enriched)
   - ✅ graduated_to_amm = true
   - ✅ metadata (social links, etc)

3. **amm_pool_states table**:
   - ✅ pool_address
   - ✅ virtual reserves (SOL and token)
   - ✅ real reserves

### Known Issues (from CLAUDE.md):
1. **AMM monitor shows 0 trades** - Subscription issue being debugged
2. **Price calculation** - Falls back to trade amounts when reserves unavailable
3. **Pool state parsing** - May have issues extracting reserves from events

### Manual Verification Required:
1. Compare SOL/token amounts with Solscan
2. Verify price calculations match market data
3. Check if tokens are actually graduated on pump.fun
4. Validate pool reserves against on-chain data
`;
    
    // Save report
    const outputDir = path.join(__dirname, '../test-results');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const reportFile = path.join(outputDir, 'AMM_DATABASE_ANALYSIS.md');
    fs.writeFileSync(reportFile, report);
    logger.info(`Report saved to: ${reportFile}`);
    
    // Also save raw data
    const rawData = {
      stats: statsData,
      sampleTrades,
      tokenInfo: tokenInfo.rows,
      poolStates: poolStates.rows,
      recentTrades: recentTrades.rows.slice(0, 20) // First 20 recent trades
    };
    
    const dataFile = path.join(outputDir, 'amm-database-data.json');
    fs.writeFileSync(dataFile, JSON.stringify(rawData, null, 2));
    logger.info(`Raw data saved to: ${dataFile}`);
    
    // Show summary
    logger.info('Analysis complete!', {
      totalTrades: statsData.total_trades,
      uniqueTokens: statsData.unique_tokens,
      totalVolume: `$${parseFloat(statsData.total_volume || 0).toLocaleString()}`
    });
    
    process.exit(0);
    
  } catch (error) {
    logger.error('Analysis failed:', error as Error);
    process.exit(1);
  }
}

// Run analysis
analyzeAMMDatabase().catch(console.error);