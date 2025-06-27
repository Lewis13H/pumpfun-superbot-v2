#!/usr/bin/env node
import { DualProgramSubscription, DualProgramEvent } from '../stream/dual-program-subscription';
import { formatPrice } from '../utils/formatters';
import { getSolPrice } from '../services/sol-price';
import chalk from 'chalk';
import dotenv from 'dotenv';

dotenv.config();

let totalTransactions = 0;
let lastHeartbeat = Date.now();

async function handleEvent(event: DualProgramEvent): Promise<void> {
  totalTransactions++;
  const solPrice = await getSolPrice();

  console.log(chalk.green(`\n✅ Transaction #${totalTransactions} received!`));

  if (event.type === 'bonding_curve') {
    const trade = event.event;
    const volumeSol = Number(trade.solAmount) / 1e9;

    console.log(chalk.magenta.bold('🔄 BONDING CURVE TRADE'));
    console.log(`Type: ${trade.isBuy ? 'BUY' : 'SELL'}`);
    console.log(`Token: ${trade.mint}`);
    console.log(`Price: ${formatPrice(trade.price, solPrice)}`);
    console.log(`Volume: ${volumeSol.toFixed(4)} SOL`);
    console.log(`User: ${trade.user}`);
    console.log(`Signature: ${trade.signature}`);

  } else if (event.type === 'amm_swap') {
    const swap = event.event;
    const volumeSol = Number(swap.solAmount) / 1e9;

    console.log(chalk.blue.bold('💱 AMM SWAP'));
    console.log(`Type: ${swap.type}`);
    console.log(`Token: ${swap.tokenMint}`);
    console.log(`SOL Amount: ${volumeSol.toFixed(4)} SOL`);
    console.log(`Token Amount: ${Number(swap.tokenAmount) / 1e6} tokens`);
    console.log(`User: ${swap.user}`);
    console.log(`Signature: ${swap.signature}`);
  }
}

// Print heartbeat every 10 seconds to show the stream is alive
setInterval(() => {
  const elapsed = Math.floor((Date.now() - lastHeartbeat) / 1000);
  console.log(chalk.gray(`\n💓 Heartbeat - Stream alive for ${elapsed}s | Total transactions: ${totalTransactions}`));
}, 10000);

async function main() {
  console.log(chalk.cyan.bold('🔍 DUAL PROGRAM MONITOR - DEBUG MODE'));
  console.log(chalk.yellow('This version shows detailed debug information\n'));

  const subscription = new DualProgramSubscription({
    onTransaction: handleEvent,
    onError: (error) => {
      console.error(chalk.red('❌ Stream error:'), error.message);
      console.error(chalk.red('Stack trace:'), error.stack);
    },
    onConnect: () => {
      console.log(chalk.green('✅ Connected to stream!'));
      console.log(chalk.gray('Waiting for transactions...'));
      lastHeartbeat = Date.now();
    },
    onDisconnect: () => {
      console.log(chalk.yellow('⚠️ Disconnected from stream'));
    },
  });

  // Also monitor just pump.fun to verify stream is working
  console.log(chalk.yellow('Starting monitoring for:'));
  console.log(chalk.yellow(`- Pump.fun: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`));
  console.log(chalk.yellow(`- Pump.swap: pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA\n`));

  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n👋 Shutting down...'));
    subscription.disconnect();
    process.exit(0);
  });

  try {
    await subscription.subscribe();
  } catch (error) {
    console.error(chalk.red('❌ Failed to start:'), error);
    process.exit(1);
  }
}

main().catch(console.error);