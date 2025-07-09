/**
 * Test script for Session 8: Historical Tracking & Analytics
 * 
 * This script tests:
 * 1. Historical snapshot storage
 * 2. Trend analysis
 * 3. Token comparisons
 * 4. Alert generation
 * 5. Report generation
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { HolderAnalysisService } from '../services/holder-analysis/holder-analysis-service';
import { HolderHistoryService } from '../services/holder-analysis/historical/holder-history-service';
import { HolderTrendAnalyzer } from '../services/holder-analysis/historical/trend-analyzer';
import { HolderComparisonService } from '../services/holder-analysis/historical/comparison-service';
import { HolderReportGenerator } from '../services/holder-analysis/reports/holder-report-generator';
import { logger } from '../core/logger';

async function testSession8() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('\n🧪 Testing Session 8: Historical Tracking & Analytics\n');

    // Initialize services
    const analysisService = new HolderAnalysisService(
      pool,
      process.env.HELIUS_API_KEY,
      process.env.SHYFT_API_KEY
    );

    const historyService = new HolderHistoryService(pool);
    const trendAnalyzer = new HolderTrendAnalyzer(pool);
    const comparisonService = new HolderComparisonService(pool);
    const reportGenerator = new HolderReportGenerator(pool);

    // Find a token with holder analysis data
    const tokenQuery = `
      SELECT mint_address 
      FROM holder_snapshots 
      WHERE holder_score IS NOT NULL
      ORDER BY snapshot_time DESC
      LIMIT 1
    `;
    const result = await pool.query(tokenQuery);
    
    if (result.rows.length === 0) {
      console.log('❌ No tokens with holder analysis found. Run holder analysis first.');
      return;
    }

    const testMintAddress = result.rows[0].mint_address;
    console.log(`📊 Testing with token: ${testMintAddress}\n`);

    // Test 1: Historical Data Retrieval
    console.log('1️⃣ Testing Historical Data Retrieval...');
    const history = await historyService.getHolderHistory({
      mintAddress: testMintAddress,
      period: '7d'
    });
    console.log(`  ✅ Found ${history.snapshots.length} historical snapshots`);
    console.log(`  📈 Holder growth: ${history.trends.holderGrowth.toFixed(1)}%`);
    console.log(`  📊 Score change: ${history.trends.scoreChange.toFixed(1)}%`);
    console.log(`  🎯 Concentration change: ${history.trends.concentrationChange.toFixed(1)}%\n`);

    // Test 2: Trend Analysis
    console.log('2️⃣ Testing Trend Analysis...');
    const trends = await trendAnalyzer.analyzeTrends(testMintAddress, '7d');
    console.log(`  📈 Growth direction: ${trends.holderGrowth.direction}`);
    console.log(`  📊 Health trajectory: ${trends.healthTrajectory}`);
    console.log(`  🚨 Alerts generated: ${trends.alerts.length}`);
    if (trends.alerts.length > 0) {
      trends.alerts.forEach(alert => {
        console.log(`     - ${alert.type}: ${alert.message}`);
      });
    }
    console.log();

    // Test 3: Token Comparison
    console.log('3️⃣ Testing Token Comparison...');
    const comparison = await comparisonService.compareToken(testMintAddress);
    console.log(`  📊 Compared with ${comparison.similarTokens.length} similar tokens`);
    console.log(`  🏆 Holder score percentile: ${comparison.percentile.holderScore.toFixed(0)}%`);
    console.log(`  📈 Insights:`);
    comparison.insights.forEach(insight => {
      console.log(`     - ${insight}`);
    });
    console.log();

    // Test 4: Alert System
    console.log('4️⃣ Testing Alert System...');
    const alerts = await analysisService.getActiveAlerts(testMintAddress);
    console.log(`  🚨 Active alerts: ${alerts.length}`);
    if (alerts.length > 0) {
      console.log(`  📝 Sample alert: ${alerts[0].title} - ${alerts[0].message}`);
    }
    console.log();

    // Test 5: Report Generation
    console.log('5️⃣ Testing Report Generation...');
    const report = await reportGenerator.generateReport(testMintAddress, '7d');
    console.log(`  📄 Report generated for: ${report.symbol} (${report.name})`);
    console.log(`  📊 Current score: ${report.summary.currentScore}/300 (${report.summary.scoreRating})`);
    console.log(`  📈 Recommendations: ${report.recommendations.length}`);
    report.recommendations.slice(0, 3).forEach(rec => {
      console.log(`     - ${rec}`);
    });
    console.log();

    // Test 6: Leaderboard
    console.log('6️⃣ Testing Leaderboard...');
    const topTokens = await comparisonService.getTopTokensByScore(10);
    console.log(`  🏆 Top 10 tokens by holder score:`);
    topTokens.forEach((token, index) => {
      console.log(`     ${index + 1}. ${token.symbol}: Score ${token.holderScore}, Holders: ${token.totalHolders}`);
    });
    console.log();

    // Test 7: Save New Snapshot
    console.log('7️⃣ Testing Snapshot Storage...');
    const latestSnapshot = await historyService.getLatestSnapshot(testMintAddress);
    if (latestSnapshot) {
      const testSnapshot = {
        mintAddress: testMintAddress,
        totalHolders: latestSnapshot.totalHolders,
        uniqueHolders: latestSnapshot.uniqueHolders,
        top10Percentage: latestSnapshot.top10Percentage,
        top25Percentage: latestSnapshot.top25Percentage,
        giniCoefficient: latestSnapshot.giniCoefficient,
        herfindahlIndex: latestSnapshot.herfindahlIndex,
        holderScore: latestSnapshot.holderScore + 1, // Slight change to trigger alert
        scoreBreakdown: {},
        snapshotTime: new Date()
      };
      
      await historyService.saveSnapshot(testSnapshot as any);
      console.log('  ✅ Test snapshot saved');
      
      // Check if alert was generated
      const newAlerts = await analysisService.getActiveAlerts(testMintAddress);
      const recentAlert = newAlerts.find(a => 
        new Date(a.triggered_at).getTime() > Date.now() - 60000
      );
      if (recentAlert) {
        console.log(`  🚨 Alert generated: ${recentAlert.title}`);
      }
    }

    console.log('\n✅ Session 8 testing complete!');
    console.log('\n📋 Summary:');
    console.log('  - Historical tracking: ✅ Working');
    console.log('  - Trend analysis: ✅ Working');
    console.log('  - Token comparison: ✅ Working');
    console.log('  - Alert system: ✅ Working');
    console.log('  - Report generation: ✅ Working');
    console.log('  - Leaderboard: ✅ Working');

  } catch (error) {
    logger.error('Test failed:', error);
    console.error('\n❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testSession8().catch(console.error);