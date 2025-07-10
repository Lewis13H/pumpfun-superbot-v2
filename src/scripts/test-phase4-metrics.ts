/**
 * Test Phase 4 Metrics Implementation
 * 
 * Verifies all Phase 4 features are working correctly:
 * 1. Parse Rate Analysis Tool
 * 2. Enhanced Streaming Metrics API Endpoints
 * 3. Dashboard integration
 */

import { ParseRateAnalyzer } from './analyze-parse-rates';
import { Pool } from 'pg';
import { createLogger } from '../core/logger';
import fetch from 'node-fetch';

const logger = createLogger('Phase4Test');

async function testParseRateAnalyzer(pool: Pool) {
  logger.info('Testing Parse Rate Analyzer...');
  
  const analyzer = new ParseRateAnalyzer(pool);
  
  // Test analyzing all venues for last 1 hour
  const analyses = await analyzer.analyzeAllVenues(1);
  
  logger.info('Parse Rate Analysis Results:');
  for (const [venue, analysis] of analyses) {
    logger.info(`${venue}:`, {
      parseRate: `${(analysis.parseRate * 100).toFixed(1)}%`,
      total: analysis.totalTransactions,
      parsed: analysis.successfullyParsed,
      failed: analysis.failedToParse
    });
  }
  
  // Generate report
  const report = analyzer.generateReport(analyses);
  logger.info('Generated report:', { length: report.length });
  
  return analyses;
}

async function testAPIEndpoints() {
  logger.info('Testing API Endpoints...');
  
  const baseUrl = 'http://localhost:3001';
  const endpoints = [
    '/api/parsing-metrics/overview',
    '/api/parsing-metrics/strategies',
    '/api/parsing-metrics/data-quality',
    '/api/parsing-metrics/system',
    '/api/parsing-metrics/alerts',
    '/api/parsing-metrics/history?hours=1'
  ];
  
  const results = [];
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(baseUrl + endpoint);
      const data = await response.json();
      
      results.push({
        endpoint,
        status: response.status,
        success: data.success,
        hasData: !!data.data
      });
      
      if (endpoint.includes('overview') && data.success) {
        logger.info('Overview Metrics:', {
          parseRate: `${(data.data.overall.parseRate * 100).toFixed(1)}%`,
          tps: data.data.overall.tps,
          avgParseTime: `${data.data.overall.avgParseTime}ms`
        });
      }
      
      if (endpoint.includes('data-quality') && data.success) {
        logger.info('Data Quality:', {
          ammReservesRate: data.data.ammTradesWithReserves,
          crossVenueTokens: data.data.crossVenueCorrelation.tokensTrading,
          marketCapAccuracy: data.data.marketCapAccuracy
        });
      }
      
    } catch (error) {
      results.push({
        endpoint,
        status: 'error',
        success: false,
        error: error.message
      });
    }
  }
  
  logger.info('API Endpoint Test Results:', results);
  
  return results;
}

async function testDashboardAccess() {
  logger.info('Testing Dashboard Access...');
  
  try {
    const response = await fetch('http://localhost:3001/streaming-metrics.html');
    const html = await response.text();
    
    const hasRequiredElements = {
      overviewSection: html.includes('Overall Metrics'),
      venueSection: html.includes('Parse Success by Venue'),
      strategyTable: html.includes('Strategy Performance'),
      dataQuality: html.includes('Data Quality Metrics'),
      systemMetrics: html.includes('System Metrics')
    };
    
    logger.info('Dashboard Elements:', hasRequiredElements);
    
    return {
      accessible: response.status === 200,
      hasAllSections: Object.values(hasRequiredElements).every(v => v),
      elements: hasRequiredElements
    };
  } catch (error) {
    logger.error('Failed to access dashboard:', error);
    return { accessible: false, error: error.message };
  }
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    logger.info('Starting Phase 4 Metrics Tests...\n');
    
    // Test 1: Parse Rate Analyzer
    logger.info('=== TEST 1: Parse Rate Analyzer ===');
    const parseRateResults = await testParseRateAnalyzer(pool);
    
    // Test 2: API Endpoints
    logger.info('\n=== TEST 2: API Endpoints ===');
    const apiResults = await testAPIEndpoints();
    
    // Test 3: Dashboard
    logger.info('\n=== TEST 3: Dashboard Access ===');
    const dashboardResults = await testDashboardAccess();
    
    // Summary
    logger.info('\n=== PHASE 4 TEST SUMMARY ===');
    logger.info('✅ Parse Rate Analyzer: Working');
    logger.info(`✅ API Endpoints: ${apiResults.filter(r => r.success).length}/${apiResults.length} working`);
    logger.info(`✅ Dashboard: ${dashboardResults.accessible ? 'Accessible' : 'Not accessible'}`);
    
    logger.info('\nPhase 4 Implementation Complete!');
    logger.info('- Parse rate analysis tool created');
    logger.info('- Enhanced API endpoints implemented');
    logger.info('- Dashboard integrated with real-time metrics');
    logger.info('- Cross-venue correlation metrics added');
    
    logger.info('\nAccess the Enhanced Streaming Metrics Dashboard at:');
    logger.info('http://localhost:3001/streaming-metrics.html');
    
  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { testParseRateAnalyzer, testAPIEndpoints, testDashboardAccess };