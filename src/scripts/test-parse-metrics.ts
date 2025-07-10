import 'dotenv/config';
import { ParsingMetricsService } from '../services/monitoring/parsing-metrics-service';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';
import { ParseContext } from '../utils/parsers/types';
import { logger } from '../core/logger';

async function testParseMetrics() {
  console.log('\n🧪 Testing Parse Metrics Collection...\n');
  
  const metricsService = ParsingMetricsService.getInstance();
  const parser = new UnifiedEventParser({ logErrors: true });
  
  // Reset metrics for clean test
  metricsService.reset();
  
  // Test 1: Successful BC Trade Parse
  console.log('Test 1: Simulating successful BC trade parse...');
  const bcContext: ParseContext = {
    signature: '5xKv3n2Y8mNp',
    slot: BigInt(123456),
    blockTime: Date.now() / 1000,
    accounts: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
    logs: [
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
      'Program log: Instruction: Buy',
      'Program log: User bought 50000000 tokens for 1000000000 lamports',
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
    ],
    userAddress: 'test-user',
    fullTransaction: {
      transaction: {
        transaction: {
          message: {
            accountKeys: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
            instructions: [{
              programIdIndex: 0,
              data: 'test'
            }]
          }
        }
      }
    }
  };
  
  const bcResult = parser.parse(bcContext);
  console.log('  BC Parse result:', bcResult ? 'SUCCESS' : 'NULL');
  
  // Test 2: Failed AMM Trade Parse
  console.log('\nTest 2: Simulating failed AMM trade parse...');
  const ammContext: ParseContext = {
    signature: '2bHj9kL43xRt',
    slot: BigInt(123457),
    blockTime: Date.now() / 1000,
    accounts: [],
    logs: [
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA invoke [1]',
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA consumed 45123 of 200000 compute units',
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA success'
    ],
    userAddress: 'test-user',
    fullTransaction: {
      transaction: {
        transaction: {
          message: {
            accountKeys: ['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'],
            instructions: [{
              programIdIndex: 0,
              data: 'test'
            }]
          }
        }
      }
    }
  };
  
  const ammResult = parser.parse(ammContext);
  console.log('  AMM Parse result:', ammResult ? 'SUCCESS' : 'NULL');
  
  // Test 3: Multiple parses to generate statistics
  console.log('\nTest 3: Simulating multiple parses...');
  for (let i = 0; i < 10; i++) {
    const success = Math.random() > 0.2; // 80% success rate
    const isBuy = Math.random() > 0.5;
    const context: ParseContext = {
      signature: `test-sig-${i}`,
      slot: BigInt(123458 + i),
      blockTime: Date.now() / 1000,
      accounts: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'testMintAddress'],
      logs: success ? [
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
        `Program log: Instruction: ${isBuy ? 'Buy' : 'Sell'}`,
        `Program log: User ${isBuy ? 'bought' : 'sold'} 50000000 tokens for 1000000000 lamports`,
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
      ] : [
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P failed: custom program error: 0x1'
      ],
      userAddress: 'test-user',
      fullTransaction: {
        transaction: {
          transaction: {
            message: {
              accountKeys: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
              instructions: [{
                programIdIndex: 0,
                data: 'test'
              }]
            }
          }
        }
      }
    };
    
    const result = parser.parse(context);
    if (i === 0) {
      console.log(`    Parse ${i} result: ${result ? 'SUCCESS' : 'NULL'} (expected: ${success ? 'SUCCESS' : 'NULL'})`);
    }
  }
  
  // Show parser's internal stats
  console.log('\nParser internal stats:', parser.getStats());
  
  // Simulate some event bus and DB activity
  for (let i = 0; i < 50; i++) {
    metricsService.trackEventBusMessage();
  }
  
  for (let i = 0; i < 30; i++) {
    metricsService.trackDbWrite();
  }
  
  // Wait a bit for metrics to settle
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Display collected metrics
  console.log('\n📊 Collected Metrics:\n');
  
  // Overview metrics
  const overview = metricsService.getOverviewMetrics();
  console.log('Overall Metrics:');
  console.log(`  Parse Rate: ${(overview.overallParseRate * 100).toFixed(1)}%`);
  console.log(`  Total Transactions: ${overview.totalTransactions}`);
  console.log(`  Successfully Parsed: ${overview.successfullyParsed}`);
  console.log(`  Failed Count: ${overview.failedCount}`);
  console.log(`  Average Parse Time: ${overview.avgParseTime.toFixed(1)}ms`);
  console.log(`  TPS: ${overview.tps.toFixed(1)}`);
  
  // Program-specific metrics
  console.log('\nProgram Metrics:');
  const pumpBCMetrics = metricsService.getProgramMetrics('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
  console.log(`  Pump.fun BC:`);
  console.log(`    Parse Rate: ${(pumpBCMetrics.parseRate * 100).toFixed(1)}%`);
  console.log(`    Total: ${pumpBCMetrics.totalTransactions}`);
  console.log(`    Successful: ${pumpBCMetrics.successfullyParsed}`);
  
  const pumpAMMMetrics = metricsService.getProgramMetrics('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
  console.log(`  Pump.swap AMM:`);
  console.log(`    Parse Rate: ${(pumpAMMMetrics.parseRate * 100).toFixed(1)}%`);
  console.log(`    Total: ${pumpAMMMetrics.totalTransactions}`);
  console.log(`    Successful: ${pumpAMMMetrics.successfullyParsed}`);
  
  // Strategy metrics
  console.log('\nStrategy Performance:');
  const strategies = metricsService.getStrategyMetrics();
  strategies.forEach(s => {
    console.log(`  ${s.strategy}:`);
    console.log(`    Success Rate: ${(s.successRate * 100).toFixed(1)}%`);
    console.log(`    Attempts: ${s.attempts}`);
    console.log(`    Avg Parse Time: ${s.avgParseTime.toFixed(1)}ms`);
    if (s.topErrors.length > 0) {
      console.log(`    Top Errors: ${s.topErrors.map(([err, count]) => `${err} (${count})`).join(', ')}`);
    }
  });
  
  // Recent failures
  console.log('\nRecent Failures:');
  const failures = metricsService.getRecentFailures(5);
  failures.forEach(f => {
    console.log(`  ${f.signature} - ${f.strategy} - ${f.error}`);
  });
  
  // System metrics
  console.log('\nSystem Metrics:');
  console.log(`  Parse Queue Depth: ${metricsService.getQueueDepth()}`);
  console.log(`  Event Bus Messages/sec: ${metricsService.getEventBusRate().toFixed(1)}`);
  console.log(`  DB Write Throughput: ${metricsService.getDbWriteRate().toFixed(1)}/s`);
  const memUsage = process.memoryUsage();
  console.log(`  Memory Usage: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)}MB`);
  
  // Check for alerts
  console.log('\nAlert Check:');
  const alerts = metricsService.checkAlertThresholds();
  if (alerts.length > 0) {
    alerts.forEach(alert => {
      console.log(`  ⚠️  ${alert.severity.toUpperCase()}: ${alert.message}`);
    });
  } else {
    console.log('  ✅ No alerts triggered');
  }
  
  console.log('\n✅ Parse metrics test completed!');
  console.log('\n💡 The streaming metrics dashboard at http://localhost:3001/streaming-metrics.html');
  console.log('   will display these metrics in real-time when the monitors are running.\n');
}

// Run the test
testParseMetrics().catch(console.error);