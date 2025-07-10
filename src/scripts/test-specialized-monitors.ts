/**
 * Test Specialized Monitors
 * Tests the pool creation and BC completion monitors
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import { EventBus } from '../core/event-bus';
import { PoolCreationMonitor } from '../monitors/specialized/pool-creation-monitor';
import { BondingCurveCompletionMonitor } from '../monitors/specialized/bonding-curve-completion-monitor';
import chalk from 'chalk';

async function testSpecializedMonitors() {
  console.log(chalk.cyan('🧪 Testing Specialized Monitors\n'));
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  const eventBus = new EventBus();
  
  try {
    // Start pool creation monitor
    console.log(chalk.magenta('Starting Pool Creation Monitor...'));
    const poolMonitor = new PoolCreationMonitor(eventBus, pool);
    await poolMonitor.start();
    console.log(chalk.green('✓ Pool Creation Monitor started\n'));
    
    // Start BC completion monitor
    console.log(chalk.yellow('Starting BC Completion Monitor...'));
    const bcMonitor = new BondingCurveCompletionMonitor(eventBus, pool);
    await bcMonitor.start();
    console.log(chalk.green('✓ BC Completion Monitor started\n'));
    
    // Listen for events
    eventBus.on('TOKEN_GRADUATED', (data: any) => {
      console.log(chalk.green('\n🎓 GRADUATION EVENT:'), data);
    });
    
    eventBus.on('BONDING_CURVE_PROGRESS_UPDATE', (data: any) => {
      if (data.complete) {
        console.log(chalk.yellow('\n✅ BC COMPLETE EVENT:'), data);
      }
    });
    
    // Show initial stats
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM tokens_unified WHERE graduated_to_amm = true) as graduated,
        (SELECT COUNT(*) FROM tokens_unified WHERE bonding_curve_complete = true) as bc_complete,
        (SELECT COUNT(*) FROM tokens_unified) as total_tokens
    `);
    
    console.log(chalk.cyan('Initial Stats:'));
    console.log(`- Total tokens: ${stats.rows[0].total_tokens}`);
    console.log(`- Graduated: ${stats.rows[0].graduated}`);
    console.log(`- BC Complete: ${stats.rows[0].bc_complete}\n`);
    
    console.log(chalk.gray('Monitoring for graduations and completions...'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
    
    // Check stats periodically
    const interval = setInterval(async () => {
      const currentStats = await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM tokens_unified WHERE graduated_to_amm = true) as graduated,
          (SELECT COUNT(*) FROM tokens_unified WHERE bonding_curve_complete = true) as bc_complete,
          (SELECT COUNT(*) FROM tokens_unified WHERE updated_at >= NOW() - INTERVAL '5 minutes') as recently_updated
      `);
      
      console.log(chalk.gray(`[${new Date().toLocaleTimeString()}] Stats: Graduated: ${currentStats.rows[0].graduated} | BC Complete: ${currentStats.rows[0].bc_complete} | Recent Updates: ${currentStats.rows[0].recently_updated}`));
    }, 60000);
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\nShutting down...'));
      clearInterval(interval);
      await poolMonitor.stop();
      await bcMonitor.stop();
      await pool.end();
      process.exit(0);
    });
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    await pool.end();
    process.exit(1);
  }
}

testSpecializedMonitors().catch(console.error);