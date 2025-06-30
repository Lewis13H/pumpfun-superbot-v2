import { BaseMonitor, MonitorConfig } from '../core/base-monitor';
import chalk from 'chalk';
import { PUMP_PROGRAM } from '../utils/constants';

/**
 * Test implementation of BaseMonitor to verify the abstraction works
 */
class TestMonitor extends BaseMonitor {
  private processedCount = 0;

  constructor() {
    const config: MonitorConfig = {
      programId: PUMP_PROGRAM,
      monitorName: 'Test Monitor',
      color: chalk.cyan,
      reconnectDelayMs: 2000,
      displayIntervalMs: 5000
    };
    super(config);
  }

  async processStreamData(data: any): Promise<void> {
    // Simulate processing
    this.processedCount++;
    console.log(this.config.color(`📦 Processing transaction #${this.processedCount}`));
    
    // Add custom stats
    this.stats.processed = this.processedCount;
    this.stats.successRate = ((this.processedCount - this.stats.errors) / this.processedCount * 100).toFixed(2);
  }

  displayStats(): void {
    const runtime = Date.now() - this.stats.startTime.getTime();
    const txRate = this.calculateRate(this.stats.transactions, this.stats.startTime);
    
    console.log(this.config.color('\n═══════════════════════════════════════════════════'));
    console.log(this.config.color(`📊 ${this.config.monitorName} Statistics`));
    console.log(this.config.color('═══════════════════════════════════════════════════'));
    console.log(this.config.color(`⏱️  Runtime: ${this.formatDuration(runtime)}`));
    console.log(this.config.color(`📈 Transactions: ${this.formatNumber(this.stats.transactions)} (${txRate.toFixed(1)}/min)`));
    console.log(this.config.color(`✅ Processed: ${this.formatNumber(this.processedCount)}`));
    console.log(this.config.color(`❌ Errors: ${this.formatNumber(this.stats.errors)}`));
    console.log(this.config.color(`🔄 Reconnections: ${this.stats.reconnections}`));
    console.log(this.config.color(`💰 SOL Price: $${this.currentSolPrice.toFixed(2)}`));
    console.log(this.config.color(`📊 Success Rate: ${this.stats.successRate || '0.00'}%`));
    console.log(this.config.color('═══════════════════════════════════════════════════\n'));
  }

  shouldLogError(error: any): boolean {
    // Log all errors for testing
    return true;
  }

  async onShutdown(): Promise<void> {
    console.log(this.config.color('🧹 Cleaning up test monitor...'));
    // Any cleanup logic would go here
  }
}

// Run test
async function runTest() {
  console.log(chalk.green('\n🧪 Testing BaseMonitor abstraction...\n'));
  
  const monitor = new TestMonitor();
  
  // Test methods directly
  console.log(chalk.yellow('Testing utility methods:'));
  console.log(`Format number: ${monitor['formatNumber'](1234567)}`);
  console.log(`Format duration: ${monitor['formatDuration'](3661000)}`);
  console.log(`Calculate rate: ${monitor['calculateRate'](100, new Date(Date.now() - 60000))}/min`);
  
  console.log(chalk.yellow('\n\nStarting monitor (will run for 30 seconds)...\n'));
  
  // Run for 30 seconds then stop
  setTimeout(() => {
    console.log(chalk.red('\n\n⏰ Test time limit reached, shutting down...'));
    process.exit(0);
  }, 30000);
  
  await monitor.start();
}

runTest().catch(console.error);