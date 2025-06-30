#!/usr/bin/env tsx
/**
 * Integration Test Runner
 * Runs all integration tests with proper setup and teardown
 */

import { spawn } from 'child_process';
import chalk from 'chalk';
import path from 'path';

interface TestSuite {
  name: string;
  file: string;
  timeout?: number;
}

const testSuites: TestSuite[] = [
  { name: 'Container DI Tests', file: 'container.test.ts' },
  { name: 'EventBus Tests', file: 'event-bus.test.ts' },
  { name: 'Monitor Integration Tests', file: 'monitor-integration.test.ts' },
  { name: 'WebSocket Integration Tests', file: 'websocket-integration.test.ts' },
  { name: 'System E2E Tests', file: 'system-e2e.test.ts', timeout: 30000 }
];

async function runTest(suite: TestSuite): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(chalk.blue(`\n▶ Running ${suite.name}...`));
    
    const testPath = path.join(__dirname, 'integration', suite.file);
    const args = [
      '--test',
      testPath,
      '--test-timeout=' + (suite.timeout || 10000)
    ];
    
    const proc = spawn('tsx', args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test'
      }
    });
    
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log(chalk.green(`✓ ${suite.name} passed`));
        resolve(true);
      } else {
        console.log(chalk.red(`✗ ${suite.name} failed`));
        resolve(false);
      }
    });
    
    proc.on('error', (err) => {
      console.error(chalk.red(`Failed to run ${suite.name}:`, err));
      resolve(false);
    });
  });
}

async function runAllTests() {
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════╗
║           🧪 Integration Test Suite 🧪                ║
║                                                       ║
║          Testing Refactored Architecture              ║
╚═══════════════════════════════════════════════════════╝
`));

  const startTime = Date.now();
  const results: boolean[] = [];
  
  // Run tests sequentially to avoid port conflicts
  for (const suite of testSuites) {
    const result = await runTest(suite);
    results.push(result);
  }
  
  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const passed = results.filter(r => r).length;
  const failed = results.filter(r => !r).length;
  
  console.log(chalk.cyan('\n' + '═'.repeat(55)));
  console.log(chalk.cyan('Test Summary:'));
  console.log(chalk.green(`  ✓ Passed: ${passed}`));
  if (failed > 0) {
    console.log(chalk.red(`  ✗ Failed: ${failed}`));
  }
  console.log(chalk.gray(`  Duration: ${duration}s`));
  console.log(chalk.cyan('═'.repeat(55) + '\n'));
  
  process.exit(failed > 0 ? 1 : 0);
}

// Handle interrupts gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\nTest run interrupted'));
  process.exit(1);
});

// Run tests
runAllTests().catch(console.error);