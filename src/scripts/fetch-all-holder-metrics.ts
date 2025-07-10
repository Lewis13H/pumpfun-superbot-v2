#!/usr/bin/env node
/**
 * Fetch Comprehensive Holder Metrics for All Analyzed Tokens
 * 
 * This script fetches comprehensive holder metrics data for all tokens
 * that have completed holder analysis, providing a detailed report.
 */

import { Pool } from 'pg';
import { createLogger } from '../core/logger';
import { db } from '../database';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('FetchHolderMetrics');

interface HolderMetricsData {
  // Token basic info
  mintAddress: string;
  symbol: string;
  name: string;
  imageUri?: string;
  latestMarketCapUsd?: number;
  latestPriceSol?: number;
  latestPriceUsd?: number;
  graduatedToAmm?: boolean;
  currentProgram?: string;
  
  // Holder analysis metadata
  analysisDate?: Date;
  analysisStatus?: string;
  holdersAnalyzed?: number;
  
  // Holder metrics from holder_analysis_metadata
  holderScore?: number;
  holderCount?: number;
  uniqueHolders?: number;
  top10Percentage?: number;
  top25Percentage?: number;
  top100Percentage?: number;
  giniCoefficient?: number;
  herfindahlIndex?: number;
  scoreBreakdown?: any;
  
  // Wallet type distribution
  botPercentage?: number;
  sniperPercentage?: number;
  developerPercentage?: number;
  whalePercentage?: number;
  normalPercentage?: number;
  
  // Additional metrics
  totalSupplyHeld?: string;
  avgBalance?: string;
  medianBalance?: string;
  lockedSupply?: string;
  
  // Historical data
  historicalSnapshots?: number;
  latestTrends?: any;
  activeAlerts?: number;
}

async function fetchComprehensiveMetrics(pool: Pool): Promise<HolderMetricsData[]> {
  const query = `
    WITH latest_snapshots AS (
      -- Get the most recent snapshot with scores for each token
      SELECT DISTINCT ON (hs.mint_address)
        hs.*,
        t.symbol,
        t.name,
        t.image_uri,
        t.latest_market_cap_usd,
        t.latest_price_sol,
        t.latest_price_usd,
        t.graduated_to_amm,
        t.current_program
      FROM holder_snapshots hs
      JOIN tokens_unified t ON hs.mint_address = t.mint_address
      WHERE hs.holder_score IS NOT NULL
      ORDER BY hs.mint_address, hs.created_at DESC
    ),
    latest_analysis AS (
      -- Get analysis metadata for tokens with snapshots
      SELECT DISTINCT ON (ham.mint_address)
        ham.*
      FROM holder_analysis_metadata ham
      WHERE ham.mint_address IN (SELECT mint_address FROM latest_snapshots)
        AND ham.status = 'completed'
      ORDER BY ham.mint_address, ham.created_at DESC
    ),
    holder_stats AS (
      -- Calculate holder statistics
      SELECT 
        thd.mint_address,
        COUNT(DISTINCT thd.wallet_address) as holder_count,
        SUM(thd.balance) as total_supply_held,
        AVG(thd.balance) as avg_balance,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY thd.balance) as median_balance,
        SUM(CASE WHEN thd.is_locked THEN thd.balance ELSE 0 END) as locked_supply
      FROM token_holder_details thd
      WHERE thd.mint_address IN (SELECT mint_address FROM latest_snapshots)
        AND thd.balance > 0
      GROUP BY thd.mint_address
    ),
    wallet_type_stats AS (
      -- Calculate wallet type distribution
      SELECT 
        thd.mint_address,
        COUNT(CASE WHEN wc.classification = 'bot' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) as bot_percentage,
        COUNT(CASE WHEN wc.classification = 'sniper' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) as sniper_percentage,
        COUNT(CASE WHEN wc.classification = 'developer' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) as developer_percentage,
        COUNT(CASE WHEN wc.classification = 'whale' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) as whale_percentage,
        COUNT(CASE WHEN wc.classification = 'normal' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) as normal_percentage
      FROM token_holder_details thd
      LEFT JOIN wallet_classifications wc ON thd.wallet_address = wc.wallet_address
      WHERE thd.mint_address IN (SELECT mint_address FROM latest_snapshots)
        AND thd.balance > 0
      GROUP BY thd.mint_address
    ),
    historical_counts AS (
      -- Count historical snapshots
      SELECT 
        mint_address,
        COUNT(*) as snapshot_count
      FROM holder_snapshots
      WHERE mint_address IN (SELECT mint_address FROM latest_snapshots)
      GROUP BY mint_address
    ),
    active_alerts AS (
      -- Count active alerts
      SELECT 
        mint_address,
        COUNT(*) as alert_count
      FROM holder_alerts
      WHERE mint_address IN (SELECT mint_address FROM latest_snapshots)
        AND acknowledged = false
      GROUP BY mint_address
    )
    SELECT 
      ls.*,
      la.status as analysis_status,
      la.holders_analyzed,
      la.created_at as analysis_date,
      hs.holder_count as calculated_holder_count,
      hs.total_supply_held,
      hs.avg_balance,
      hs.median_balance,
      hs.locked_supply,
      wts.bot_percentage,
      wts.sniper_percentage,
      wts.developer_percentage,
      wts.whale_percentage,
      wts.normal_percentage,
      hc.snapshot_count,
      aa.alert_count
    FROM latest_snapshots ls
    LEFT JOIN latest_analysis la ON ls.mint_address = la.mint_address
    LEFT JOIN holder_stats hs ON ls.mint_address = hs.mint_address
    LEFT JOIN wallet_type_stats wts ON ls.mint_address = wts.mint_address
    LEFT JOIN historical_counts hc ON ls.mint_address = hc.mint_address
    LEFT JOIN active_alerts aa ON ls.mint_address = aa.mint_address
    ORDER BY ls.holder_score DESC, ls.latest_market_cap_usd DESC
  `;

  const result = await pool.query(query);
  
  return result.rows.map(row => ({
    // Token basic info
    mintAddress: row.mint_address,
    symbol: row.symbol,
    name: row.name,
    imageUri: row.image_uri,
    latestMarketCapUsd: row.latest_market_cap_usd ? parseFloat(row.latest_market_cap_usd) : undefined,
    latestPriceSol: row.latest_price_sol ? parseFloat(row.latest_price_sol) : undefined,
    latestPriceUsd: row.latest_price_usd ? parseFloat(row.latest_price_usd) : undefined,
    graduatedToAmm: row.graduated_to_amm,
    currentProgram: row.current_program,
    
    // Holder analysis metadata
    analysisDate: row.created_at,
    analysisStatus: row.status,
    holdersAnalyzed: row.holders_analyzed,
    
    // Holder metrics
    holderScore: row.holder_score,
    holderCount: row.total_holders || row.holder_count || row.calculated_holder_count,
    uniqueHolders: row.unique_holders,
    top10Percentage: row.top_10_percentage ? parseFloat(row.top_10_percentage) : undefined,
    top25Percentage: row.top_25_percentage ? parseFloat(row.top_25_percentage) : undefined,
    top100Percentage: row.top_100_percentage ? parseFloat(row.top_100_percentage) : undefined,
    giniCoefficient: row.gini_coefficient ? parseFloat(row.gini_coefficient) : undefined,
    herfindahlIndex: row.herfindahl_index ? parseFloat(row.herfindahl_index) : undefined,
    scoreBreakdown: row.score_breakdown,
    
    // Wallet type distribution
    botPercentage: row.bot_percentage ? parseFloat(row.bot_percentage) : undefined,
    sniperPercentage: row.sniper_percentage ? parseFloat(row.sniper_percentage) : undefined,
    developerPercentage: row.developer_percentage ? parseFloat(row.developer_percentage) : undefined,
    whalePercentage: row.whale_percentage ? parseFloat(row.whale_percentage) : undefined,
    normalPercentage: row.normal_percentage ? parseFloat(row.normal_percentage) : undefined,
    
    // Additional metrics
    totalSupplyHeld: row.total_supply_held,
    avgBalance: row.avg_balance,
    medianBalance: row.median_balance,
    lockedSupply: row.locked_supply,
    
    // Historical data
    historicalSnapshots: row.snapshot_count || 0,
    activeAlerts: row.alert_count || 0
  }));
}

function generateReport(metrics: HolderMetricsData[]): string {
  let report = '# Comprehensive Holder Metrics Report\n\n';
  report += `Generated: ${new Date().toISOString()}\n`;
  report += `Total Tokens Analyzed: ${metrics.length}\n\n`;
  
  // Summary statistics
  const avgScore = metrics.reduce((sum, m) => sum + (m.holderScore || 0), 0) / metrics.length;
  const highScoreTokens = metrics.filter(m => (m.holderScore || 0) >= 200).length;
  const mediumScoreTokens = metrics.filter(m => (m.holderScore || 0) >= 100 && (m.holderScore || 0) < 200).length;
  const lowScoreTokens = metrics.filter(m => (m.holderScore || 0) < 100).length;
  
  report += '## Summary Statistics\n';
  report += `- Average Holder Score: ${avgScore.toFixed(2)}\n`;
  report += `- High Score Tokens (≥200): ${highScoreTokens}\n`;
  report += `- Medium Score Tokens (100-199): ${mediumScoreTokens}\n`;
  report += `- Low Score Tokens (<100): ${lowScoreTokens}\n\n`;
  
  // Top 10 tokens by holder score
  report += '## Top 10 Tokens by Holder Score\n\n';
  const top10 = metrics.slice(0, 10);
  
  for (const token of top10) {
    report += `### ${token.symbol} (${token.name})\n`;
    report += `- **Mint Address**: ${token.mintAddress}\n`;
    report += `- **Holder Score**: ${token.holderScore}/300\n`;
    report += `- **Market Cap**: $${(token.latestMarketCapUsd || 0).toLocaleString()}\n`;
    report += `- **Holder Count**: ${(token.holderCount || 0).toLocaleString()}\n`;
    report += `- **Unique Holders**: ${(token.uniqueHolders || 0).toLocaleString()}\n`;
    report += `- **Top 10 Hold**: ${(token.top10Percentage || 0).toFixed(2)}%\n`;
    report += `- **Gini Coefficient**: ${(token.giniCoefficient || 0).toFixed(4)}\n`;
    
    if (token.scoreBreakdown) {
      report += `- **Score Breakdown**:\n`;
      const breakdown = typeof token.scoreBreakdown === 'string' 
        ? JSON.parse(token.scoreBreakdown) 
        : token.scoreBreakdown;
      
      for (const [key, value] of Object.entries(breakdown)) {
        report += `  - ${key}: ${value}\n`;
      }
    }
    
    report += `- **Wallet Types**:\n`;
    report += `  - Bots: ${(token.botPercentage || 0).toFixed(2)}%\n`;
    report += `  - Snipers: ${(token.sniperPercentage || 0).toFixed(2)}%\n`;
    report += `  - Developers: ${(token.developerPercentage || 0).toFixed(2)}%\n`;
    report += `  - Whales: ${(token.whalePercentage || 0).toFixed(2)}%\n`;
    report += `  - Normal: ${(token.normalPercentage || 0).toFixed(2)}%\n`;
    report += '\n';
  }
  
  // Tokens with alerts
  const tokensWithAlerts = metrics.filter(m => (m.activeAlerts || 0) > 0);
  if (tokensWithAlerts.length > 0) {
    report += '## Tokens with Active Alerts\n\n';
    for (const token of tokensWithAlerts) {
      report += `- ${token.symbol}: ${token.activeAlerts} alerts\n`;
    }
    report += '\n';
  }
  
  // Full data export
  report += '## Full Data Export\n';
  report += 'See `holder_metrics_data.json` for complete data export.\n';
  
  return report;
}

async function main() {
  const pool = db.getPool();
  
  try {
    logger.info('Fetching comprehensive holder metrics...');
    
    const metrics = await fetchComprehensiveMetrics(pool);
    logger.info(`Fetched metrics for ${metrics.length} tokens`);
    
    // Generate report
    const report = generateReport(metrics);
    
    // Save report
    const outputDir = path.join(__dirname, '../../output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const reportPath = path.join(outputDir, `holder_metrics_report_${new Date().toISOString().split('T')[0]}.md`);
    fs.writeFileSync(reportPath, report);
    logger.info(`Report saved to: ${reportPath}`);
    
    // Save full data as JSON
    const dataPath = path.join(outputDir, `holder_metrics_data_${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(dataPath, JSON.stringify(metrics, null, 2));
    logger.info(`Full data saved to: ${dataPath}`);
    
    // Print summary to console
    console.log('\n=== Holder Metrics Summary ===');
    console.log(`Total Tokens Analyzed: ${metrics.length}`);
    console.log(`Average Holder Score: ${(metrics.reduce((sum, m) => sum + (m.holderScore || 0), 0) / metrics.length).toFixed(2)}`);
    console.log('\nTop 5 Tokens by Holder Score:');
    
    metrics.slice(0, 5).forEach((token, index) => {
      console.log(`${index + 1}. ${token.symbol} - Score: ${token.holderScore}/300, Market Cap: $${(token.latestMarketCapUsd || 0).toLocaleString()}`);
    });
    
  } catch (error) {
    logger.error('Failed to fetch holder metrics:', error);
    process.exit(1);
  } finally {
    // Don't end the pool since it's a singleton
  }
}

// Check if additional columns exist
async function checkColumnExistence(pool: Pool) {
  const checkQuery = `
    SELECT 
      column_name, 
      data_type 
    FROM information_schema.columns 
    WHERE table_name = 'holder_analysis_metadata' 
      AND column_name IN (
        'holder_score', 'holder_count', 'top_10_percentage', 
        'bot_percentage', 'sniper_percentage', 'developer_percentage'
      )
    ORDER BY column_name
  `;
  
  const result = await pool.query(checkQuery);
  
  if (result.rows.length === 0) {
    logger.warn('Additional holder metrics columns not found in holder_analysis_metadata table');
    logger.info('Running migration to add missing columns...');
    
    // Add missing columns
    const alterQuery = `
      ALTER TABLE holder_analysis_metadata
      ADD COLUMN IF NOT EXISTS holder_score INTEGER CHECK (holder_score >= 0 AND holder_score <= 300),
      ADD COLUMN IF NOT EXISTS holder_count INTEGER,
      ADD COLUMN IF NOT EXISTS unique_holders INTEGER,
      ADD COLUMN IF NOT EXISTS top_10_percentage DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS top_25_percentage DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS top_100_percentage DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS gini_coefficient DECIMAL(5,4),
      ADD COLUMN IF NOT EXISTS herfindahl_index DECIMAL(5,4),
      ADD COLUMN IF NOT EXISTS bot_percentage DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS sniper_percentage DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS developer_percentage DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS whale_percentage DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS normal_percentage DECIMAL(5,2)
    `;
    
    await pool.query(alterQuery);
    logger.info('Migration completed successfully');
  } else {
    logger.info(`Found ${result.rows.length} holder metrics columns in database`);
  }
}

// Run the script
(async () => {
  const pool = db.getPool();
  
  try {
    // Check and add columns if needed
    await checkColumnExistence(pool);
    
    // Run main function
    await main();
  } catch (error) {
    logger.error('Script failed:', error);
    process.exit(1);
  }
})();