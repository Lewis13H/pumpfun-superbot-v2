/**
 * Unified Monitor Output Formatter
 * Provides consistent terminal output styling across all monitors
 */

import chalk from 'chalk';

export class MonitorFormatter {
  private startTime: Date;
  private stats: {
    transactions: number;
    trades: number;
    errors: number;
    warnings: number;
  };

  constructor() {
    this.startTime = new Date();
    this.stats = {
      transactions: 0,
      trades: 0,
      errors: 0,
      warnings: 0
    };
  }

  /**
   * Display monitor header
   */
  header(title: string, programId: string, config: Record<string, any> = {}) {
    console.clear();
    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.cyan.bold(`  ${title}`));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.gray(`Program: ${programId}`));
    console.log(chalk.gray(`Started: ${this.startTime.toISOString()}`));
    
    // Display configuration
    if (Object.keys(config).length > 0) {
      const configStr = Object.entries(config)
        .map(([key, value]) => `${key}: ${chalk.yellow(value)}`)
        .join(' | ');
      console.log(chalk.gray(configStr));
    }
    
    console.log(chalk.cyan('─'.repeat(80)));
  }

  /**
   * Display real-time statistics
   */
  displayStats(customStats: Record<string, any> = {}) {
    const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    
    console.log('\n' + chalk.white.bold('📊 STATISTICS'));
    console.log(chalk.gray('─'.repeat(40)));
    
    // Default stats
    console.log(`Uptime: ${chalk.green(`${hours}h ${minutes}m ${seconds}s`)}`);
    console.log(`Transactions: ${chalk.blue(this.stats.transactions)} | Trades: ${chalk.blue(this.stats.trades)}`);
    console.log(`Errors: ${chalk.red(this.stats.errors)} | Warnings: ${chalk.yellow(this.stats.warnings)}`);
    
    // Custom stats
    Object.entries(customStats).forEach(([key, value]) => {
      console.log(`${key}: ${chalk.cyan(value)}`);
    });
  }

  /**
   * Log a trade event
   */
  logTrade(trade: {
    type: 'buy' | 'sell';
    mint: string;
    amount: number;
    price: number;
    user?: string;
    signature?: string;
  }) {
    this.stats.trades++;
    
    const icon = trade.type === 'buy' ? '🟢' : '🔴';
    const color = trade.type === 'buy' ? chalk.green : chalk.red;
    
    console.log('\n' + chalk.white.bold(`${icon} ${trade.type.toUpperCase()} TRADE`));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`Token: ${chalk.yellow(trade.mint.slice(0, 8))}...`);
    console.log(`Amount: ${color(`$${trade.amount.toFixed(2)}`)}`);
    console.log(`Price: ${chalk.white(`$${trade.price.toFixed(6)}`)}`);
    
    if (trade.user) {
      console.log(`User: ${chalk.gray(trade.user.slice(0, 8))}...`);
    }
    
    if (trade.signature) {
      console.log(`Sig: ${chalk.gray(trade.signature.slice(0, 12))}...`);
    }
  }

  /**
   * Log an account update
   */
  logAccountUpdate(update: {
    type: string;
    account: string;
    data: Record<string, any>;
  }) {
    console.log('\n' + chalk.white.bold(`📍 ${update.type}`));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`Account: ${chalk.yellow(update.account.slice(0, 8))}...`);
    
    Object.entries(update.data).forEach(([key, value]) => {
      console.log(`${key}: ${chalk.cyan(value)}`);
    });
  }

  /**
   * Log an error
   */
  logError(message: string, error?: any) {
    this.stats.errors++;
    console.log('\n' + chalk.red.bold('❌ ERROR'));
    console.log(chalk.red(message));
    if (error && process.env.DEBUG_ERRORS === 'true') {
      console.log(chalk.gray(error.stack || error.toString()));
    }
  }

  /**
   * Log a warning
   */
  logWarning(message: string) {
    this.stats.warnings++;
    console.log(chalk.yellow(`⚠️  ${message}`));
  }

  /**
   * Log success
   */
  logSuccess(message: string) {
    console.log(chalk.green(`✅ ${message}`));
  }

  /**
   * Log info
   */
  logInfo(message: string) {
    console.log(chalk.blue(`ℹ️  ${message}`));
  }

  /**
   * Update stats
   */
  incrementStat(key: keyof typeof MonitorFormatter.prototype.stats) {
    this.stats[key]++;
  }

  /**
   * Get current stats
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Display footer
   */
  footer() {
    console.log('\n' + chalk.cyan('─'.repeat(80)));
    console.log(chalk.gray('Press Ctrl+C to stop monitoring...'));
  }
}

// Export singleton instances for each monitor type
export const bcTradeFormatter = new MonitorFormatter();
export const bcAccountFormatter = new MonitorFormatter();
export const ammTradeFormatter = new MonitorFormatter();
export const ammAccountFormatter = new MonitorFormatter();