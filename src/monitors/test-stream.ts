#!/usr/bin/env node
import { SimpleSubscriptionHandler } from '../stream/subscription-simple';
import chalk from 'chalk';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log(chalk.cyan.bold('🔍 TESTING BASIC PUMP.FUN STREAM'));
  console.log(chalk.yellow('This will verify if the stream is working at all\n'));

  const handler = new SimpleSubscriptionHandler();
  
  // Override the default output to show debug info
  const originalLog = console.log;
  let transactionCount = 0;
  
  console.log = (...args: any[]) => {
    if (args[0]?.includes('Token Found:')) {
      transactionCount++;
      originalLog(chalk.green(`✅ Transaction #${transactionCount} received!`));
      originalLog(...args);
    } else {
      originalLog(...args);
    }
  };

  // Heartbeat to show stream is alive
  const heartbeatInterval = setInterval(() => {
    originalLog(chalk.gray(`💓 Stream alive - Transactions received: ${transactionCount}`));
  }, 10000);

  process.on('SIGINT', async () => {
    originalLog(chalk.yellow('\n👋 Shutting down...'));
    clearInterval(heartbeatInterval);
    await handler.stop();
    process.exit(0);
  });

  try {
    originalLog(chalk.yellow('Starting pump.fun stream only...'));
    await handler.start();
  } catch (error) {
    originalLog(chalk.red('❌ Failed to start:'), error);
    clearInterval(heartbeatInterval);
    process.exit(1);
  }
}

main().catch(console.error);