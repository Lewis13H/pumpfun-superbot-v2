#!/usr/bin/env node
/**
 * Test AMM monitors for a short duration
 */

import { spawn } from 'child_process';
import chalk from 'chalk';

const DURATION = 30000; // 30 seconds

async function testMonitor(name: string, command: string) {
  console.log(chalk.cyan(`\n🧪 Testing ${name} for ${DURATION/1000} seconds...\n`));
  
  return new Promise<void>((resolve) => {
    const child = spawn('npm', ['run', command], {
      cwd: process.cwd(),
      stdio: 'inherit'
    });
    
    // Stop after duration
    setTimeout(() => {
      console.log(chalk.yellow(`\n⏱️  Stopping ${name}...`));
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 1000);
    }, DURATION);
    
    child.on('exit', () => {
      console.log(chalk.green(`✅ ${name} test completed`));
      resolve();
    });
  });
}

async function runTests() {
  console.log(chalk.cyan.bold('🔍 Testing AMM Monitors\n'));
  
  // Test account monitor
  await testMonitor('AMM Account Monitor', 'amm-account-monitor');
  
  // Test trade monitor
  await testMonitor('AMM Trade Monitor', 'amm-monitor');
  
  console.log(chalk.green.bold('\n✅ All tests completed!'));
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\nStopping tests...'));
  process.exit(0);
});

// Run tests
runTests().catch(console.error);