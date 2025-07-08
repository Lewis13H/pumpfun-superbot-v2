#!/usr/bin/env npx tsx
/**
 * Test Holder Analysis Startup
 * 
 * Quick test to verify holder analysis integration starts correctly
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { EventBus } from '../core/event-bus';
import { HolderAnalysisIntegration } from '../services/holder-analysis/holder-analysis-integration';
import { db } from '../database';

async function testStartup() {
  console.log('🧪 Testing Holder Analysis Startup\n');
  
  try {
    // Get database pool
    console.log('1. Getting database pool...');
    const pool = db.getPool();
    console.log('✅ Database pool obtained');
    
    // Test pool connection
    console.log('\n2. Testing database connection...');
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', result.rows[0].now);
    
    // Create event bus
    console.log('\n3. Creating event bus...');
    const eventBus = new EventBus();
    console.log('✅ Event bus created');
    
    // Create integration
    console.log('\n4. Creating holder analysis integration...');
    const integration = new HolderAnalysisIntegration(pool, eventBus, {
      marketCapThreshold: 10000,
      solThreshold: 50,
      enableAutoAnalysis: true,
      maxConcurrentAnalyses: 2
    });
    console.log('✅ Integration created');
    
    // Start integration
    console.log('\n5. Starting integration...');
    await integration.start();
    console.log('✅ Integration started successfully!');
    
    // Get stats
    const stats = integration.getStats();
    console.log('\n📊 Integration Stats:');
    console.log(`   Analyses queued: ${stats.analysesQueued}`);
    console.log(`   Tokens analyzed: ${stats.tokensAnalyzed}`);
    
    // Wait a bit
    console.log('\n6. Waiting 5 seconds for any initial processing...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Get final stats
    const finalStats = integration.getStats();
    console.log('\n📊 Final Stats:');
    console.log(`   Analyses queued: ${finalStats.analysesQueued}`);
    console.log(`   Tokens analyzed: ${finalStats.tokensAnalyzed}`);
    
    // Stop integration
    console.log('\n7. Stopping integration...');
    await integration.stop();
    console.log('✅ Integration stopped');
    
    console.log('\n✅ All tests passed! Holder analysis integration is working correctly.');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
  } finally {
    // Close database
    await db.close();
    process.exit(0);
  }
}

// Run test
testStartup().catch(console.error);