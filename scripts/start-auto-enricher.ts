#!/usr/bin/env tsx

/**
 * Start Enhanced Auto-Enricher Service
 * Continuously enriches tokens above $8,888 market cap
 */

import chalk from 'chalk';
import { config } from 'dotenv';
import { EnhancedAutoEnricher } from '../src/services/enhanced-auto-enricher';

config();

async function startEnricher() {
  console.log(chalk.cyan.bold('\n🤖 Enhanced Auto-Enricher Service\n'));
  console.log(chalk.gray('Enriching tokens above $8,888 market cap...'));
  console.log(chalk.gray('Check interval: 30 seconds'));
  console.log(chalk.gray('Batch size: 20 tokens\n'));
  
  const enricher = EnhancedAutoEnricher.getInstance();
  
  try {
    // Start the enricher service
    await enricher.start();
    
    console.log(chalk.green('✅ Enricher service started successfully!\n'));
    
    // Keep the process running
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n⚠️  Shutting down enricher service...'));
      enricher.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log(chalk.yellow('\n⚠️  Shutting down enricher service...'));
      enricher.stop();
      process.exit(0);
    });
    
    // Print stats every 5 minutes
    setInterval(() => {
      const stats = enricher.getStats();
      const timestamp = new Date().toLocaleTimeString();
      console.log(chalk.gray(`\n[${timestamp}] Enrichment Stats:`));
      console.log(chalk.gray(`  Total: ${stats.totalEnriched} | Queue: ${stats.queueSize} | Sources: S:${stats.shyftSuccess} H:${stats.heliusSuccess} F:${stats.fallback}`));
    }, 5 * 60 * 1000);
    
  } catch (error) {
    console.error(chalk.red('❌ Failed to start enricher:'), error);
    process.exit(1);
  }
}

// Start the enricher
startEnricher().catch(console.error);